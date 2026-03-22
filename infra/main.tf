provider "aws" {
  region = "us-east-2"
}

resource "aws_cloudwatch_log_group" "overmind_log_group" {
  name              = "/ecs/overmind"
  retention_in_days = 7
}

variable "region_name" {
  type    = string
  default = "us-east-2"
}

variable "app_name" {
  type    = string
  default = "overmind"
}

variable "account_id" {
  type    = string
  default = "048270140082"
}

variable "ecr_image_tag" {
  type    = string
  default = "latest"
}

# SSM Parameter Store secrets — must match names in /overmind/* in SSM
variable "ssm_parameter_names" {
  type = list(string)
  default = [
    "GEMINI_API_KEY",
    "MODEL_ID",
    "NGROK_AUTHTOKEN",
    "OPENAI_API_KEY",
    "OVERMIND_DATABASE_URL",
    "OVERMIND_EMBEDDING_DIMS",
    "OVERMIND_EMBEDDING_MODEL",
    "OVERMIND_ORCHESTRATOR_URL",
  ]
}

# ── IAM: ECS Task Execution Role (already exists, created via CLI) ──

data "aws_iam_role" "ecs_execution" {
  name = "ecsTaskExecutionRole"
}

# data: it's a resource which already exists
data "aws_vpc" "default" {
  default = true
}

output "default_vpc_id" {
  description = "prints ID of default VPC"
  value       = data.aws_vpc.default.id
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

output "default_subnet_ids" {
  description = "prints all Subnet IDs belonging to VPC"
  value       = data.aws_subnets.default.ids
}

# pick an ID, then use existing security group
resource "aws_security_group" "default" {
  name        = "overmind-ecs-sg"
  description = "Overmind ECS tasks"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
# since this already exists, import this into terraform


# output group id
output "aws_security_group_id" {
  description = "aws overmind ecs security group ID"
  value       = resource.aws_security_group.default.id
}

locals {
  subnet_ids  = slice(data.aws_subnets.default.ids, 0, 2)
  sg_group_id = resource.aws_security_group.default.id
  ecr_image   = "${var.account_id}.dkr.ecr.${var.region_name}.amazonaws.com/overmind-orchestrator-repo:${var.ecr_image_tag}"
  ssm_prefix  = "overmind"
}

#  ECS Cluster 
resource "aws_ecs_cluster" "main" {
  name = "overmind-ecs-cluster"
}

#  ALB Security Group 
resource "aws_security_group" "alb_sg" {
  name        = "overmind-alb-sg"
  description = "Allow HTTP inbound to ALB"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ALB 
resource "aws_lb" "main" {
  name               = "overmind-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = data.aws_subnets.default.ids
}

#  Target Group (points to ECS tasks on port 8000) 
resource "aws_lb_target_group" "main" {
  name        = "overmind-tg"
  port        = 8000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.default.id

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

#  Listener (HTTP:80 → target group) 
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.main.arn
  }
}

# ── ECS Task Definition ──
# Mirrors the task-def.json from command_logs/aws_commands, now with SSM secrets.

resource "aws_ecs_task_definition" "main" {
  family                   = "overmind-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = data.aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([
    {
      name      = "overmind-container"
      image     = local.ecr_image
      essential = true

      portMappings = [
        {
          containerPort = 8000
          protocol      = "tcp"
        }
      ]

      # Secrets injected from SSM Parameter Store (overmind/SECRET_NAME)
      secrets = [
        for name in var.ssm_parameter_names : {
          name      = name
          valueFrom = "arn:aws:ssm:${var.region_name}:${var.account_id}:parameter/${local.ssm_prefix}/${name}"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.overmind_log_group.name
          "awslogs-region"        = var.region_name
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

# ── ECS Service ──

resource "aws_ecs_service" "main" {
  name            = "overmind-orchestrator"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.main.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.default.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.main.arn
    container_name   = "overmind-container"
    container_port   = 8000
  }
}

# Outputs 
output "alb_dns_name" {
  description = "ALB DNS name — use as OVERMIND_ORCHESTRATOR_URL"
  value       = "http://${aws_lb.main.dns_name}"
}

aws ecs update-service \
    --cluster overmind-ecs-cluster \
    --service overmind-orchestrator \
    --desired-count 0 \
    --region us-east-2
  echo "ECS scaled to 0. Monthly cost now ~$0."
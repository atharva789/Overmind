#!/bin/bash
# Kill-switch: scale ECS service to 0 (stops all tasks, preserves infrastructure)
set -e

CLUSTER="overmind-ecs-cluster"
SERVICE="overmind-orchestrator"
REGION="us-east-2"

echo "Scaling $SERVICE to 0..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --desired-count 0 \
  --region "$REGION" \
  --query "service.{desired:desiredCount,status:status}" \
  --output table

echo "Done. To restart: aws ecs update-service --cluster $CLUSTER --service $SERVICE --desired-count 1 --region $REGION"

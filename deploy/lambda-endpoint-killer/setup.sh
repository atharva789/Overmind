#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION="us-east-1"
ACCOUNT_ID="048270140082"
SNS_TOPIC_ARN="arn:aws:sns:${REGION}:${ACCOUNT_ID}:sagemaker-budget-alarm"
ROLE_NAME="SageMakerEndpointKillerLambdaRole"
FUNCTION_NAME="sagemaker-endpoint-killer"
ALARM_NAME="SageMaker-50-Dollar-Alert"
THRESHOLD=50

echo ""
echo "=== SageMaker Auto-Delete Pipeline Setup ==="
echo "Region:    ${REGION}"
echo "Account:   ${ACCOUNT_ID}"
echo "Threshold: \$${THRESHOLD}"
echo ""

# ── Step 1: Create SNS topic ──
echo "==> Step 1: Creating SNS topic..."
aws sns create-topic --name sagemaker-budget-alarm --region "${REGION}" --output text --query TopicArn
echo ""

# ── Step 2: Subscribe email (you must confirm via the link in your inbox) ──
read -rp "Enter your email for notifications: " EMAIL
echo "==> Step 2: Subscribing ${EMAIL} to SNS topic..."
aws sns subscribe \
  --topic-arn "${SNS_TOPIC_ARN}" \
  --protocol email \
  --notification-endpoint "${EMAIL}" \
  --region "${REGION}"
echo ""
echo "    CHECK YOUR EMAIL and click the confirmation link before continuing."
read -rp "    Press Enter once you've confirmed the subscription..."
echo ""

# ── Step 3: Create IAM role for Lambda ──
echo "==> Step 3: Creating IAM role..."
aws iam create-role \
  --role-name "${ROLE_NAME}" \
  --assume-role-policy-document "file://${SCRIPT_DIR}/trust-policy.json" \
  --description "Lambda role for auto-deleting SageMaker endpoints on budget breach" \
  --output text --query Role.Arn || echo "    (role may already exist, continuing)"

echo "==> Step 3b: Attaching permissions policy..."
aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name SageMakerEndpointKillerPolicy \
  --policy-document "file://${SCRIPT_DIR}/permissions-policy.json"

echo "    Waiting 10s for IAM role propagation..."
sleep 10
echo ""

# ── Step 4: Package and deploy Lambda ──
echo "==> Step 4: Packaging Lambda..."
cd "${SCRIPT_DIR}"
zip -j /tmp/sagemaker-killer-lambda.zip lambda_function.py

echo "==> Step 4b: Creating Lambda function..."
aws lambda create-function \
  --function-name "${FUNCTION_NAME}" \
  --runtime python3.12 \
  --handler lambda_function.handler \
  --role "arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}" \
  --zip-file fileb:///tmp/sagemaker-killer-lambda.zip \
  --timeout 60 \
  --memory-size 128 \
  --environment "Variables={SNS_TOPIC_ARN=${SNS_TOPIC_ARN}}" \
  --region "${REGION}" \
  --output text --query FunctionArn || echo "    (function may already exist, continuing)"
echo ""

# ── Step 5: Wire SNS → Lambda ──
echo "==> Step 5: Granting SNS permission to invoke Lambda..."
aws lambda add-permission \
  --function-name "${FUNCTION_NAME}" \
  --statement-id sns-invoke-permission \
  --action lambda:InvokeFunction \
  --principal sns.amazonaws.com \
  --source-arn "${SNS_TOPIC_ARN}" \
  --region "${REGION}" 2>/dev/null || echo "    (permission may already exist, continuing)"

echo "==> Step 5b: Subscribing Lambda to SNS topic..."
aws sns subscribe \
  --topic-arn "${SNS_TOPIC_ARN}" \
  --protocol lambda \
  --notification-endpoint "arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}" \
  --region "${REGION}"
echo ""

# ── Step 6: Create CloudWatch billing alarm ──
echo "==> Step 6: Creating CloudWatch billing alarm (\$${THRESHOLD})..."
aws cloudwatch put-metric-alarm \
  --alarm-name "${ALARM_NAME}" \
  --alarm-description "Triggers endpoint deletion when SageMaker charges exceed \$${THRESHOLD}" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 21600 \
  --threshold "${THRESHOLD}" \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=ServiceName,Value=AmazonSageMaker \
  --alarm-actions "${SNS_TOPIC_ARN}" \
  --region "${REGION}"
echo ""

# ── Done ──
echo "=== Setup complete ==="
echo ""
echo "Pipeline: CloudWatch alarm → SNS → Email + Lambda → Delete endpoints → Email status"
echo ""
echo "To test the Lambda manually:"
echo "  aws lambda invoke --function-name ${FUNCTION_NAME} \\"
echo "    --payload '{\"Records\":[{\"Sns\":{\"Message\":\"{\\\\\"AlarmName\\\\\":\\\\\"TEST\\\\\",\\\\\"NewStateReason\\\\\":\\\\\"Manual test\\\\\"}\"}}]}' \\"
echo "    --cli-binary-format raw-in-base64-out /tmp/lambda-response.json --region ${REGION}"
echo "  cat /tmp/lambda-response.json"
echo ""
echo "To verify logs after testing:"
echo "  aws logs tail /aws/lambda/${FUNCTION_NAME} --region ${REGION} --since 10m"

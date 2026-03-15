"""
Auto-delete SageMaker endpoints when a CloudWatch billing alarm fires.
Sends email notifications at every stage via SNS.

Trigger: CloudWatch alarm → SNS → this Lambda.
"""

import json
import os

import boto3

sagemaker = boto3.client("sagemaker")
sns = boto3.client("sns")

SNS_TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]


def _publish(subject: str, message: str) -> None:
    """Publish an SNS notification. Swallows errors so deletion still proceeds."""
    try:
        sns.publish(TopicArn=SNS_TOPIC_ARN, Subject=subject[:100], Message=message)
        print(f"SNS sent: {subject}")
    except Exception as exc:
        print(f"SNS publish failed (non-fatal): {exc}")


def _parse_alarm_reason(event: dict) -> str:
    """Extract the alarm reason from the SNS event, or return a fallback."""
    try:
        record = event["Records"][0]["Sns"]["Message"]
        alarm = json.loads(record)
        return (
            f"Alarm: {alarm.get('AlarmName', 'unknown')}\n"
            f"Reason: {alarm.get('NewStateReason', 'unknown')}"
        )
    except Exception:
        return "Could not parse alarm details."


def handler(event, context):
    alarm_info = _parse_alarm_reason(event)
    print(f"Alarm triggered:\n{alarm_info}")

    # List all running endpoints
    response = sagemaker.list_endpoints(StatusEquals="InService")
    endpoints = [ep["EndpointName"] for ep in response["Endpoints"]]

    if not endpoints:
        _publish(
            "COMPLETE: No SageMaker endpoints to delete",
            f"Budget alarm fired but no InService endpoints found.\n\n{alarm_info}",
        )
        return {"status": "no_endpoints"}

    # Notify: starting delete
    _publish(
        f"STARTING: Deleting {len(endpoints)} SageMaker endpoint(s)",
        f"Budget alarm fired. Attempting to delete:\n"
        + "\n".join(f"  - {name}" for name in endpoints)
        + f"\n\n{alarm_info}",
    )

    deleted = []
    failed = []

    for name in endpoints:
        try:
            sagemaker.delete_endpoint(EndpointName=name)
            deleted.append(name)
            print(f"Deleted endpoint: {name}")
        except Exception as exc:
            failed.append((name, str(exc)))
            print(f"Failed to delete {name}: {exc}")

    # Notify: results
    if not failed:
        _publish(
            f"SUCCESS: Deleted {len(deleted)} SageMaker endpoint(s)",
            "All endpoints deleted successfully:\n"
            + "\n".join(f"  - {name}" for name in deleted)
            + "\n\nBilling for these endpoints has stopped.",
        )
        return {"status": "success", "deleted": deleted}

    # Partial or total failure
    lines = []
    if deleted:
        lines.append("Successfully deleted:")
        lines.extend(f"  - {name}" for name in deleted)
    lines.append("\nFAILED to delete (manual action required):")
    for name, err in failed:
        lines.append(f"  - {name}: {err}")
        lines.append(f"    Fix: aws sagemaker delete-endpoint --endpoint-name {name}")

    _publish(
        f"FAILED: {len(failed)} endpoint(s) need manual deletion",
        "\n".join(lines),
    )
    return {"status": "partial_failure", "deleted": deleted, "failed": failed}

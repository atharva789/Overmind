import os
import sagemaker
from sagemaker.huggingface import HuggingFaceModel
import boto3

try:
    from sagemaker.huggingface import get_huggingface_llm_image_uri
except ImportError:
    from sagemaker.huggingface_llm import get_huggingface_llm_image_uri

sess = sagemaker.Session()
region = sess.boto_region_name
def get_execution_role():
    try:
        return sagemaker.get_execution_role()
    except ValueError:
        role = os.environ.get("SAGEMAKER_EXECUTION_ROLE")
        if not role:
            raise ValueError(
                "Not in SageMaker and SAGEMAKER_EXECUTION_ROLE not set. "
                "Export it as: export SAGEMAKER_EXECUTION_ROLE=arn:aws:iam::...:role/SageMakerExecutionRole"
            )
        return role

role = get_execution_role()

llm_image = get_huggingface_llm_image_uri(
    "huggingface",
    version="2.0.2"
)

print(f"Using container image: {llm_image}")

hub_env = {
    'HF_MODEL_ID': 'Qwen/Qwen3.5-35B-A3B',
    'SM_NUM_GPUS': '4',
    'MAX_INPUT_LENGTH': '6144',
    'MAX_TOTAL_TOKENS': '8192',
    'HF_MODEL_QUANTIZE': 'bitsandbytes',
    'OPTION_ROLLING_BATCH': 'vllm',
}

model = HuggingFaceModel(
    image_uri=llm_image,
    env=hub_env,
    role=role,
    name="overmind-qwen-model"
)

print("Deploying endpoint (this will take 10-20 minutes)")

endpoint_name = "overmind-qwen-endpoint"

predictor = model.deploy(
    initial_instance_count=1,
    instance_type="ml.g5.12xlarge",
    endpoint_name=endpoint_name,
    container_startup_health_check_timeout=900,
)

print(f"Successfully deployed endpoint: {predictor.endpoint_name}")

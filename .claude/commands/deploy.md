---
description: Build, push, and deploy API and Web container images
---

Deterministic deploy flow that avoids `:latest` cache traps. Both images are ARM64.

**Prerequisites**: `AWS_ACCOUNT_ID` env var must be set (the commands below use it
literally). The simplest way is to derive it from the active AWS identity:

```bash
export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
```

1. **Determine the SHA tag**:
   ```bash
   TAG="$(git rev-parse --short HEAD)-$(date +%s)"
   ```

2. **ECR login**:
   ```bash
   aws ecr get-login-password --region ap-northeast-2 \
     | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com
   ```

3. **Build both images** (ARM64):
   ```bash
   docker build --platform linux/arm64 -f api/Dockerfile \
     -t $AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/ontology-retail-dev-api:$TAG \
     -t $AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/ontology-retail-dev-api:latest .

   docker build --platform linux/arm64 -f web/Dockerfile \
     -t $AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/ontology-retail-dev-web:$TAG \
     -t $AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/ontology-retail-dev-web:latest .
   ```

4. **Push** (both SHA tag and `:latest`):
   ```bash
   docker push $AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/ontology-retail-dev-api:$TAG
   docker push $AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/ontology-retail-dev-api:latest
   docker push $AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/ontology-retail-dev-web:$TAG
   docker push $AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/ontology-retail-dev-web:latest
   ```

5. **Register SHA-pinned task definitions** (avoids ECR `:latest` cache):
   - Describe current task definition.
   - Replace the container image with the SHA tag.
   - Register a new revision.
   - Update the service to use the new revision with `--force-new-deployment`.

6. **Wait for rollout** to reach `COMPLETED` for both services.

7. **Verify** with the smoke checks from `/test-all`.

If any task fails ELB health check, inspect CloudWatch logs at `/aws/ecs/ontology-retail-dev/{api,web}` for the failing task ID — common causes are syntax errors in newly added routers or missing env vars.

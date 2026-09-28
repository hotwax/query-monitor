-- Per-machine AWS region override for CloudWatch monitoring — added after
-- discovering a real setup with instances split across two regions
-- (us-east-1 prod + replicas, us-west-2 UAT), which a single global
-- AWS_REGION can't represent. Nullable, additive — safe against existing
-- rows; a machine with no override just keeps using the app-wide
-- AWS_REGION env var (see src/lib/cloudwatch.ts).

ALTER TABLE "DbConnection" ADD COLUMN "awsRegion" TEXT;

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_ENV="$REPO_ROOT/packages/db/.env"
CLUSTER_TAG_KEY="project"
CLUSTER_TAG_VALUE="serverless-webapp-starter-kit-dev"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [options]

Commands:
  create    Create a DSQL cluster for local development
  delete    Delete the development DSQL cluster

Options:
  --region REGION   AWS region (default: us-east-1)
  --help            Show this help message
EOF
}

get_cluster_id() {
  local region="$1"
  aws dsql list-clusters --region "$region" --output json 2>/dev/null \
    | jq -r ".clusters[] | select(.tags.${CLUSTER_TAG_KEY} == \"${CLUSTER_TAG_VALUE}\") | .identifier" \
    | head -1
}

cmd_create() {
  local region="${1:-us-east-1}"

  local existing
  existing=$(get_cluster_id "$region")
  if [[ -n "$existing" ]]; then
    echo "Cluster already exists: $existing"
  else
    echo "Creating DSQL cluster in $region..."
    existing=$(aws dsql create-cluster \
      --region "$region" \
      --tags "{\"${CLUSTER_TAG_KEY}\": \"${CLUSTER_TAG_VALUE}\"}" \
      --no-deletion-protection-enabled \
      --output text --query identifier)
    echo "Cluster created: $existing"
    echo "Waiting for cluster to become ACTIVE..."
    aws dsql get-cluster --identifier "$existing" --region "$region" \
      --output text --query status
    # Poll until active
    while true; do
      local status
      status=$(aws dsql get-cluster --identifier "$existing" --region "$region" \
        --output text --query status)
      if [[ "$status" == "ACTIVE" ]]; then
        echo "Cluster is ACTIVE"
        break
      fi
      echo "  status: $status"
      sleep 5
    done
  fi

  local endpoint
  endpoint=$(aws dsql get-cluster --identifier "$existing" --region "$region" \
    --output text --query endpoint)

  cat > "$DB_ENV" <<ENVEOF
DSQL_ENDPOINT=$endpoint
AWS_REGION=$region
ENVEOF
  echo "Wrote $DB_ENV"
}

cmd_delete() {
  local region="${1:-us-east-1}"

  local cluster_id
  cluster_id=$(get_cluster_id "$region")
  if [[ -z "$cluster_id" ]]; then
    echo "No development cluster found in $region"
    return 0
  fi

  echo "Deleting cluster $cluster_id in $region..."
  aws dsql delete-cluster --identifier "$cluster_id" --region "$region"
  echo "Cluster deletion initiated"
  rm -f "$DB_ENV"
}

main() {
  local command=""
  local region="us-east-1"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      create|delete) command="$1"; shift ;;
      --region) region="$2"; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) echo "Unknown argument: $1"; usage; exit 1 ;;
    esac
  done

  if [[ -z "$command" ]]; then
    usage
    exit 1
  fi

  case "$command" in
    create) cmd_create "$region" ;;
    delete) cmd_delete "$region" ;;
  esac
}

main "$@"

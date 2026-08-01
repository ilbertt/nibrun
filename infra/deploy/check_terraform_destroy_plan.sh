#!/usr/bin/env bash
# Fails a plan that would destroy or replace anything not explicitly allowed.
# The data volume holds Postgres and the artifacts bucket holds users' uploaded
# binaries, so an unnoticed replace is unrecoverable.
set -euo pipefail

plan_file="${1:-tfplan}"

if [ ! -f "$plan_file" ]; then
  echo "Usage: $0 <terraform-plan-file>" >&2
  exit 2
fi

mapfile -t destroyed_addresses < <(
  terraform show -json "$plan_file" \
    | jq -r '.resource_changes[]? | select(.change.actions | index("delete")) | .address' \
    | sort -u
)

if [ "${#destroyed_addresses[@]}" -eq 0 ]; then
  exit 0
fi

mapfile -t allowed_addresses < <(
  printf '%s\n' "${ALLOWED_TERRAFORM_DESTROY_ADDRESSES:-}" \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | awk 'NF' \
    | sort -u
)

is_allowed_address() {
  local candidate="$1"
  local allowed

  for allowed in "${allowed_addresses[@]}"; do
    if [ "$candidate" = "$allowed" ]; then
      return 0
    fi
  done

  return 1
}

expected_addresses=()
unexpected_addresses=()
for address in "${destroyed_addresses[@]}"; do
  if is_allowed_address "$address"; then
    expected_addresses+=("$address")
  else
    unexpected_addresses+=("$address")
  fi
done

write_summary() {
  local title="$1"
  local body="$2"

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## $title"
      printf '%s\n' "$body"
    } >> "$GITHUB_STEP_SUMMARY"
  else
    {
      echo "$title"
      printf '%s\n' "$body"
    } >&2
  fi
}

format_addresses() {
  printf '```\n'
  printf '%s\n' "$@"
  printf '```\n'
}

if [ "${#unexpected_addresses[@]}" -gt 0 ]; then
  summary="The plan would destroy or replace resources that are not explicitly allowed:"
  summary+=$'\n'
  summary+="$(format_addresses "${unexpected_addresses[@]}")"

  if [ "${#expected_addresses[@]}" -gt 0 ]; then
    summary+=$'\n'
    summary+="The plan also includes these allowed destroys/replacements:"
    summary+=$'\n'
    summary+="$(format_addresses "${expected_addresses[@]}")"
  fi

  summary+=$'\n'
  summary+='If intentional, rerun the workflow via workflow_dispatch with `allow_destroy` enabled.'
  write_summary "Destructive terraform plan blocked" "$summary"

  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::error title=Destructive terraform plan blocked::Plan destroys/replaces: $(printf '%s ' "${unexpected_addresses[@]}")"
  else
    printf 'Error: Terraform plan destroys/replaces unexpected resources: ' >&2
    printf '%s ' "${unexpected_addresses[@]}" >&2
    printf '\n' >&2
  fi

  exit 1
fi

summary="The plan only destroys or replaces explicitly allowed resources:"
summary+=$'\n'
summary+="$(format_addresses "${expected_addresses[@]}")"
write_summary "Allowed terraform destroys" "$summary"

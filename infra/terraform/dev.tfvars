region      = "eu-west-2"
environment = "dev"

control_plane_instance_type    = "t3.large"
control_plane_data_volume_size = 50

host_count            = 1
host_instance_type    = "c7i.large"
host_data_volume_size = 100

root_volume_size = 50

# api_hostname, apps_domain and acme_email have no defaults and are not set here
# — the domains are not bought yet. Pass them at apply time
# (-var api_hostname=… or TF_VAR_api_hostname) until they are settled, then move
# them into this file. apps_domain must be a different registrable domain from
# api_hostname.

# Needs www_hostname, and blocks the apply on ACM validation.
enable_www_cdn = false

github_repo          = "ilbertt/nibrun"
github_branch        = "main"
ssm_secret_prefix    = "/nibrun/dev"
enable_github_deploy = true

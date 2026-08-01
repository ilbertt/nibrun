region      = "eu-west-2"
environment = "dev"

control_plane_instance_type    = "t3.large"
control_plane_data_volume_size = 50

host_count            = 1
host_instance_type    = "c7i.large"
host_data_volume_size = 100

root_volume_size = 50

api_hostname            = "app.nibrun.com"
apps_domain             = "nibrun.app"
www_hostname            = "nibrun.com"
www_alternate_hostnames = ["www.nibrun.com"]
acme_email              = "ops@nibrun.com"

# Flip on once the www hostnames resolve to you — see infra/README.md.
enable_www_cdn = false

github_repo          = "ilbertt/nibrun"
github_branch        = "main"
ssm_secret_prefix    = "/nibrun/dev"
enable_github_deploy = true

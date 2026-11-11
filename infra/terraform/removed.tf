# Keep existing SSM values available to older host releases during a rollback.
removed {
  from = aws_ssm_parameter.dozzle_password

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_ssm_parameter.victorialogs_password

  lifecycle {
    destroy = false
  }
}

removed {
  from = random_password.dozzle_password

  lifecycle {
    destroy = false
  }
}

removed {
  from = random_password.victorialogs_password

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_ssm_parameter.dozzle_password

  lifecycle {
    destroy = true
  }
}

removed {
  from = aws_ssm_parameter.victorialogs_password

  lifecycle {
    destroy = true
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

# OCI Deployment Quick Start

Complete guide: [infra/oci/README.md](infra/oci/README.md)

## Prerequisites

- OCI CLI configured (`~/.oci/config`)
- SSH key pair (`~/.ssh/id_rsa`, `~/.ssh/id_rsa.pub`)
- Terraform installed (`brew install terraform`)

## Deploy in 10 Steps

### 1. Configure Terraform

```bash
cd backend/infra/oci
cp terraform.tfvars.example terraform.tfvars
vim terraform.tfvars  # Add your fingerprint from ~/.oci/config
```

### 2. Create Infrastructure

```bash
make -C backend oci-apply
# Wait ~3 minutes for cloud-init
```

### 3. Verify Provisioning

```bash
make -C backend oci-ssh
tail -f /var/log/cloud-init-output.log
# Wait for "provisioning complete", then exit
```

### 4. Generate Secrets

```bash
# On the instance (via SSH)
cd /opt/marketing-backend
mkdir -p secrets
openssl rand -hex 32 > secrets/db_password.txt
openssl rand -hex 32 > secrets/ip_hash_pepper.txt
openssl rand -hex 32 > secrets/admin_api_key.txt
chmod 600 secrets/*.txt
```

### 5. Configure Environment

```bash
# Still on the instance
cp .env.oci.example .env.oci
vim .env.oci  # Update CORS_ALLOWED_ORIGINS, PRIVACY_CONTACT_EMAIL
exit
```

### 6. Deploy Code

```bash
# From local machine
make -C backend oci-deploy
```

### 7. Verify Health

```bash
make -C backend oci-health
make -C backend oci-logs
```

### 8. Enable Auto-Start

```bash
ssh ubuntu@<instance-ip>
sudo systemctl enable marketing-backend
```

✅ **Done!** Backend running at `http://<instance-ip>:3000`

## Common Operations

```bash
# Deploy updates
make -C backend oci-deploy

# View logs
make -C backend oci-logs

# SSH into instance
make -C backend oci-ssh

# Health check
make -C backend oci-health

# Show instance IP
make -C backend oci-output
```

## Next Steps

- [ ] Add HTTPS with Caddy/nginx + Let's Encrypt
- [ ] Integrate Replicate.com API for ML service
- [ ] Set up database backups to OCI Object Storage
- [ ] Configure OCI Monitoring/Alarms
- [ ] Restrict SSH to your IP in `terraform.tfvars`

## Cost

**$0/month** (OCI Always Free tier)

## Support

- [Full OCI deployment docs](infra/oci/README.md)
- [Backend service rules](../agentic/instructions/backend/service-rules.md)
- [OCI CLI patterns](../agentic/instructions/available-tools.md#oci-cli)

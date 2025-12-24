#!/bin/bash
set -e
set -x

SCRIPT_DIR=$(dirname "$0")
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
OUTPUT_DIR="${PROJECT_ROOT}/scripts/dex-certs"

mkdir -p "${OUTPUT_DIR}"

# Get host IP address for nip.io
HOST_IP=$(ip route get 8.8.8.8 | awk '{print $7; exit}' || hostname -I | awk '{print $1}')
if [ -z "$HOST_IP" ]; then
    echo "Error: Could not determine host IP address"
    exit 1
fi

DEX_HOST="${HOST_IP}.nip.io"
echo "Using Dex hostname: ${DEX_HOST}"

# Save hostname for use in other scripts
echo "${DEX_HOST}" > "${OUTPUT_DIR}/dex-hostname.txt"

# Create openssl config for server certificate
cat > "${OUTPUT_DIR}/openssl.cnf" <<EOF
[ req ]
distinguished_name = req_distinguished_name
req_extensions = v3_req

[ req_distinguished_name ]

[ v3_req ]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = ${DEX_HOST}
DNS.2 = ${DEX_HOST}:10443
EOF

# Create openssl config for CA certificate
cat > "${OUTPUT_DIR}/ca.cnf" <<EOF
[ req ]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca

[ req_distinguished_name ]

[ v3_ca ]
basicConstraints = CA:TRUE
EOF

# Generate CA key and certificate (self-signed with CA:TRUE)
openssl genrsa -out "${OUTPUT_DIR}/dex-ca.key" 2048
openssl req -new -key "${OUTPUT_DIR}/dex-ca.key" -out "${OUTPUT_DIR}/dex-ca.csr" \
  -subj "/CN=dex-ca" -config "${OUTPUT_DIR}/ca.cnf"
openssl x509 -req -in "${OUTPUT_DIR}/dex-ca.csr" -signkey "${OUTPUT_DIR}/dex-ca.key" \
  -out "${OUTPUT_DIR}/dex-ca.crt" -days 365 -extensions v3_ca -extfile "${OUTPUT_DIR}/ca.cnf"

# Generate server key and certificate (like reference)
openssl genrsa -out "${OUTPUT_DIR}/dex-server.key" 2048
openssl req -new -key "${OUTPUT_DIR}/dex-server.key" -out "${OUTPUT_DIR}/dex-server.csr" \
  -subj "/CN=${DEX_HOST}" -config "${OUTPUT_DIR}/openssl.cnf"
openssl x509 -req -in "${OUTPUT_DIR}/dex-server.csr" \
  -CA "${OUTPUT_DIR}/dex-ca.crt" -CAkey "${OUTPUT_DIR}/dex-ca.key" -CAcreateserial \
  -out "${OUTPUT_DIR}/dex-server.crt" -sha256 -days 365 -extensions v3_req \
  -extfile "${OUTPUT_DIR}/openssl.cnf"

echo "Dex TLS certificates generated in ${OUTPUT_DIR}"

#!/bin/bash
# Setup GitHub secrets for package submission workflow
# Usage: ./scripts/setup-secrets.sh

set -e

REPO="profullstack/pairux.com"
SECRETS_DIR="$HOME/.pairux-secrets"

echo "=================================="
echo "PairUX Package Submission Secrets Setup"
echo "=================================="
echo ""

# Check if gh is installed and authenticated
if ! command -v gh &> /dev/null; then
    echo "Error: gh CLI is not installed. Install it from https://cli.github.com/"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo "Error: gh CLI is not authenticated. Run 'gh auth login' first."
    exit 1
fi

# Create secrets directory
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

echo "Step 1/4: PKG_SUBMIT_TOKEN (GitHub PAT)"
echo "----------------------------------------"
echo ""
echo "You need to create a Personal Access Token manually:"
echo "  1. Go to: https://github.com/settings/tokens?type=beta"
echo "  2. Click 'Generate new token'"
echo "  3. Name: 'pairux-pkg-submit'"
echo "  4. Repository access: Select repositories -> profullstack/pairux + package repos"
echo "  5. Permissions: Contents (Read and write)"
echo "  6. Generate and copy the token"
echo ""
read -p "Paste your GitHub PAT (input hidden): " -s PKG_SUBMIT_TOKEN
echo ""

if [ -n "$PKG_SUBMIT_TOKEN" ]; then
    echo "$PKG_SUBMIT_TOKEN" | gh secret set PKG_SUBMIT_TOKEN --repo "$REPO"
    echo "✅ PKG_SUBMIT_TOKEN set"
else
    echo "⚠️  Skipped PKG_SUBMIT_TOKEN"
fi
echo ""

echo "Step 2/4: AUR_SSH_KEY"
echo "---------------------"
AUR_KEY_FILE="$SECRETS_DIR/aur_ed25519"

if [ -f "$AUR_KEY_FILE" ]; then
    echo "Existing AUR key found at $AUR_KEY_FILE"
    read -p "Use existing key? (y/n): " USE_EXISTING
    if [ "$USE_EXISTING" != "y" ]; then
        rm -f "$AUR_KEY_FILE" "$AUR_KEY_FILE.pub"
    fi
fi

if [ ! -f "$AUR_KEY_FILE" ]; then
    echo "Generating new SSH key for AUR..."
    ssh-keygen -t ed25519 -C "aur@aur.archlinux.org" -f "$AUR_KEY_FILE" -N ""
    echo ""
    echo "✅ SSH key generated"
fi

# Base64 encode and set secret
AUR_SSH_KEY_B64=$(base64 -w 0 "$AUR_KEY_FILE")
echo "$AUR_SSH_KEY_B64" | gh secret set AUR_SSH_KEY --repo "$REPO"
echo "✅ AUR_SSH_KEY set"

echo ""
echo "📋 Add this public key to your AUR account:"
echo "   https://aur.archlinux.org/account → SSH Public Key"
echo ""
cat "$AUR_KEY_FILE.pub"
echo ""
read -p "Press Enter after adding the key to AUR..."
echo ""

echo "Step 3/4: GPG_PRIVATE_KEY"
echo "-------------------------"
GPG_KEY_FILE="$SECRETS_DIR/gpg_key.asc"

# Check for existing GPG keys
echo "Checking for existing GPG keys..."
EXISTING_KEYS=$(gpg --list-secret-keys --keyid-format=long 2>/dev/null | grep -E "^sec" | head -5 || true)

if [ -n "$EXISTING_KEYS" ]; then
    echo ""
    echo "Existing GPG keys found:"
    gpg --list-secret-keys --keyid-format=long 2>/dev/null | grep -E "^(sec|uid)" | head -10
    echo ""
    read -p "Enter key ID to use (or press Enter to generate new): " GPG_KEY_ID
fi

if [ -z "$GPG_KEY_ID" ]; then
    echo ""
    echo "Generating new GPG key for package signing..."

    # Generate GPG key in batch mode
    GPG_BATCH_FILE="$SECRETS_DIR/gpg_batch"
    cat > "$GPG_BATCH_FILE" << EOF
%echo Generating GPG key for PairUX package signing
Key-Type: RSA
Key-Length: 4096
Subkey-Type: RSA
Subkey-Length: 4096
Name-Real: PairUX Package Signing
Name-Email: packages@pairux.com
Expire-Date: 0
%no-protection
%commit
%echo Done
EOF

    gpg --batch --generate-key "$GPG_BATCH_FILE"
    rm -f "$GPG_BATCH_FILE"

    # Get the new key ID
    GPG_KEY_ID=$(gpg --list-secret-keys --keyid-format=long 2>/dev/null | grep -E "^sec" | tail -1 | sed 's/.*\/\([A-F0-9]*\).*/\1/')
    echo "✅ GPG key generated: $GPG_KEY_ID"
fi

# Export and set secret
echo "Exporting GPG key..."
gpg --armor --export-secret-keys "$GPG_KEY_ID" > "$GPG_KEY_FILE"
chmod 600 "$GPG_KEY_FILE"

GPG_PRIVATE_KEY_B64=$(base64 -w 0 "$GPG_KEY_FILE")
echo "$GPG_PRIVATE_KEY_B64" | gh secret set GPG_PRIVATE_KEY --repo "$REPO"
echo "✅ GPG_PRIVATE_KEY set"

# Export public key for reference
gpg --armor --export "$GPG_KEY_ID" > "$SECRETS_DIR/gpg_public.asc"
echo ""
echo "📋 GPG public key saved to: $SECRETS_DIR/gpg_public.asc"
echo "   You may need to publish this for APT/RPM repos"
echo ""

echo "Step 4/4: GPG_PASSPHRASE"
echo "------------------------"
echo "The generated key has no passphrase (for CI automation)."
echo "Setting empty GPG_PASSPHRASE secret..."
echo "" | gh secret set GPG_PASSPHRASE --repo "$REPO"
echo "✅ GPG_PASSPHRASE set (empty)"
echo ""

echo "=================================="
echo "Summary"
echo "=================================="
echo ""
echo "✅ All secrets have been configured!"
echo ""
echo "Secrets set in $REPO:"
gh secret list --repo "$REPO"
echo ""
echo "Local files saved in $SECRETS_DIR:"
ls -la "$SECRETS_DIR"
echo ""
echo "⚠️  IMPORTANT: Keep $SECRETS_DIR secure and backed up!"
echo ""
echo "Next steps:"
echo "  1. Verify AUR SSH key is added: https://aur.archlinux.org/account"
echo "     (Register at https://aur.archlinux.org/register if you don't have an account)"
echo ""
echo "Everything else is automatic:"
echo "  - AUR package 'pairux-bin' will be created on first push"
echo "  - GitHub repos will be auto-created on first release:"
echo "     - profullstack/homebrew-pairux"
echo "     - profullstack/scoop-pairux"
echo "     - profullstack/pairux-apt"
echo "     - profullstack/pairux-rpm"
echo ""

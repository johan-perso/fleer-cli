<!-- ###### Version française [ici](https://github.com/johan-perso/fleer-cli/blob/main/README.fr.md). -->

# Fleer | Command Line Interface

Everything you dream of in a one-to-one file sharing service: easy, privacy-first, decentralized and cross-platform, without limits.

> This GitHub repository contains the source code for the Fleer CLI, a tool that allows you to send files and folders from your computer or server to another device using any Fleer relay server. Related projects can be found on the [@johan-perso](https://github.com/johan-perso?tab=repositories&q=fleer-) profile.


## Installation

### macOS / Linux

```bash
os=$(uname -s | tr A-Z a-z); arch=$(uname -m)
case $arch in x86_64) arch=x64;; aarch64) arch=arm64;; esac
[ -f /etc/alpine-release ] && arch="$arch-musl"

curl -fsSL "https://github.com/johan-perso/fleer-cli/releases/latest/download/fleer-$os-$arch" -o fleer
chmod +x fleer

sudo mkdir -p /usr/local/bin
sudo mv fleer /usr/local/bin/
```

<details>
<summary>Or, if you want commands that are easier to read rather than copy-paste, you can edit and run the following commands in your terminal:</summary>

```bash
# Replace <target> with: darwin-arm64, darwin-x64, linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl
curl -fsSL https://github.com/johan-perso/fleer-cli/releases/latest/download/fleer-<target> -o fleer
chmod +x fleer
sudo mkdir -p /usr/local/bin
sudo mv fleer /usr/local/bin/
```
</details>

> For macOS users, if you downloaded the binary from your browser and macOS blocks it, run `xattr -d com.apple.quarantine /usr/local/bin/fleer` ; this is due to Apple's security policies that requires developers to pay 99$ per year to get their apps notarized.

### Windows

```powershell
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "x64" }
$dir = "$env:LOCALAPPDATA\fleer"; New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest "https://github.com/johan-perso/fleer-cli/releases/latest/download/fleer-windows-$arch.exe" -OutFile "$dir\fleer.exe"
$p = [Environment]::GetEnvironmentVariable("Path", "User"); if ($p -notlike "*$dir*") { [Environment]::SetEnvironmentVariable("Path", "$p;$dir", "User") }
echo "Fleer CLI installed to $dir\fleer.exe. Please restart your terminal or log out and log back in for the PATH changes to take effect."
```

Or, download [`fleer-windows-x64.exe`](https://github.com/johan-perso/fleer-cli/releases/latest/download/fleer-windows-x64.exe) for x64 architecture / [`fleer-windows-arm64.exe`](https://github.com/johan-perso/fleer-cli/releases/latest/download/fleer-windows-arm64.exe) for ARM64 architecture, and add the folder to your PATH.

## Development

**Requirements:**
- You need to have [Bun](https://bun.sh/) installed on your system to run the Fleer CLI itself.
- If you also want to selfhost a relay server on your machine, you can follow this [README.md](https://github.com/johan-perso/fleer-relay#hosting) and add the URL to `~/.fleer/relays_list.txt` (e.g. `http://localhost:8080`).

**Installing the CLI:**
```bash
git clone https://github.com/johan-perso/fleer-cli.git
cd fleer-cli

bun install
bun link

fleer --help
```

## License

MIT © [Johan](https://johanstick.fr/). [Support this project](https://johanstick.fr/#donate) if you want to help me 💙
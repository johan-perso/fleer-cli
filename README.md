<!-- ###### Version française [ici](https://github.com/johan-perso/fleer-cli/blob/main/README.fr.md). -->

# Fleer | Command Line Interface

Everything you dream about a one-to-one file sharing service: easy, privacy-first, decentralized and cross-platform, without limits.

> This GitHub repository contains the source code for the Fleer CLI, a tool that allows you to send files and folders from your computer or server to another device using any Fleer relay server. Related projects can be found on the [@johan-perso](https://github.com/johan-perso?tab=repositories&q=fleer-) profile.

> [!IMPORTANT]  
> This project is still in development and is far from being production-ready. Tbh you should not even try to compile it yet.  
> I'm just sharing my progress for those who are curious.


## Testing

**Requirements:**
- You need to have [Bun](https://bun.sh/) installed on your system to run the Fleer CLI itself.
- You need to have a Fleer relay server running somewhere. *As the project is still in development, there is no public relay server available yet.*

**Selfhosting the [relay server](https://github.com/johan-perso/fleer-relay/):**
```bash
git clone https://github.com/johan-perso/fleer-relay.git
cd fleer-relay
cp .env.example .env

# 1. Run in development mode using Dart SDK (if you have it installed on your machine)
dart pub get
dart run bin/server.dart

# 2. Run in production mode using Docker
docker build -t experimental-fleer-relay .
docker run -p 8080:8080 experimental-fleer-relay

# In either case, the relay server will be available at localhost:8080,
# this URL needs to be set in the `src/send.js` file of the Fleer CLI project.
```

**Installing the CLI:**
```bash
git clone https://github.com/johan-perso/fleer-cli.git
cd fleer-cli

open src/send.js
# Edit the `relayServerUrl` variable (after imports) to point to your relay server
# e.g. http://127.0.0.1:8080/

bun install
bun link

fleer --help
```

<!-- ## Installation -->
<!-- Add instructions from magic command readme -->

## License

MIT © [Johan](https://johanstick.fr/). [Support this project](https://johanstick.fr/#donate) if you want to help me 💙
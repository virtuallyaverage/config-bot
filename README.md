Uses `pnpm`
`pnpm i`
`pnpm run dev`

`pnpm run build`
`pnpm run dev`

# Deploy
```bash
# Ubutntu 24.4 Oracle Cloud (smallest alloc)
# Remember to set the NC to an ephemeral public IP address.
# Only using 14% of 60gb at base.
# 9% of 6GB ram at idle

#ssh (windows): 
ssh -i "path-to-key" ubuntu@ip

# System packages
sudo apt update && sudo apt install -y git curl

# Node.js
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm 
sudo corepack enable
corepack prepare pnpm@latest --activate

# pm2
pnpm install pm2@latest -g


git clone https://github.com/virtuallyaverage/config-bot.git
cd config-bot
pnpm i
pm2 start "pnpm run start" --name config-bot

pm2 save 
pm2 startup
```

Needs A .env with this format: 
```.env
DISCORD_TOKEN=REPLACEME
GUILD_ID=REPLACEME
GITHUB_TOKEN=REPLACEME
```
import "dotenv/config";
import { Client, GatewayIntentBits, Events, Collection, MessageFlags, REST, Routes, type SlashCommandOptionsOnlyBuilder, SlashCommandBuilder } from "discord.js";
import { Octokit } from "octokit";

// commands
import { FileSubmit } from "./commands/submit.js";
import { RegisterName } from "./commands/register.js";
import { LoadSchemas } from "./caching.js";

const commands = [FileSubmit, RegisterName];

// Initialize Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// register commands
client.once(Events.ClientReady, async (c) => {
  console.log(`Discord Logged in as ${c.user.tag}`);
  console.log("Registering Events");

  const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
  await rest.put(
    Routes.applicationGuildCommands(c.user.id, process.env.GUILD_ID!),
    { body: commands.map(c => c.data.toJSON()) },
  );

  console.log("Events Registered.");
});

// handle and dispatch commands.
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  commands.forEach((com) => {
    if (interaction.commandName === com.data.name) {
      const options = interaction.options.data.map((o) => `${o.name}=${o.value ?? o.attachment?.name}`).join(", ");

      console.log(`[${new Date().toISOString()}] Running: "${com.data.name}". From: "${interaction.user.id}". With: ${options}`);
      com.execute(interaction);
    }
  });
});

client.login(process.env.DISCORD_TOKEN);

// Initialize github
const octokit =  new Octokit({ 
  auth: process.env.GITHUB_TOKEN,
  userAgent: "Discord-Config-Bot/v0.0.0",
});
const { data: {login: username}} = await octokit.rest.users.getAuthenticated();

console.log("Signed into Github as: `%s`", username);

LoadSchemas();
console.log("schemas loaded");





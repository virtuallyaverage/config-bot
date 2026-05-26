import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { db } from "../db.js";

interface Author {
  author_name: string;
}

const InsertId = db.prepare(
  `INSERT INTO authors (discord_id, author_name) VALUES (?, ?)`
);
const FindId = db.prepare(
  `SELECT author_name FROM authors WHERE discord_id = ?`
);

const NAME = "author"
const MAX_CHAR = 50;
const MIN_CHAR = 5;

const data = new SlashCommandBuilder()
    .setName("register")
    .setDescription("Link your discord account to a config author name. THIS CANNOT BE CHANGED!")
    .addStringOption((option) => option.setName(NAME).setDescription(`THIS CANNOT BE CHANGED! Author name: Must be Alpha Numeric, standard ascii, and ${MIN_CHAR}-${MAX_CHAR} characters`).setRequired(true));

async function execute(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString(NAME, true);

  if (name.toLowerCase() === "local") {
    await interaction.reply({
      content: `"local" is a reserved name, please choose a different one."`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existing = FindId.get(interaction.user.id) as Author | undefined;
  if (existing) {
    await interaction.reply({
      content: `Your name is already set to: "${existing.author_name}"`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  InsertId.run(interaction.user.id, name);
  await interaction.reply({
    content: `Your Config author name has been set to: "${name}"`,
    flags: MessageFlags.Ephemeral,
  });
}

enum FailedReason {
    None,
    TooShort,
    TooLong,
    DisallowedCharacter,
}

function Sanitized(name:string): FailedReason {
    if (name.length > MAX_CHAR) {
        return FailedReason.TooLong;
    } else if (name.length < MIN_CHAR) {
        return FailedReason.TooShort;
    } else if (!/^[a-zA-Z0-9]+$/.test(name)) {
        return FailedReason.DisallowedCharacter;
    }
    return FailedReason.None;
}

export const RegisterName = {
  data,
  execute,
};
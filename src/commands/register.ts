import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import Database from "better-sqlite3";
import { db } from "../db.js";
import { randomUUID } from "crypto";

interface Author {
  author_name: string;
}

const insertAuthor = db.prepare(
  `INSERT INTO authors (discord_id, author_name, author_id) VALUES (?, ?, ?)`,
);
const FindId = db.prepare(
  `SELECT author_name FROM authors WHERE discord_id = ?`,
);

const NAME = "author";
const MAX_CHAR = 50;
const MIN_CHAR = 5;

const data = new SlashCommandBuilder()
  .setName("register")
  .setDescription(
    "Link your discord account to a config author name. THIS CANNOT BE CHANGED!",
  )
  .addStringOption((option) =>
    option
      .setName(NAME)
      .setDescription(
        `THIS CANNOT BE CHANGED! Author name: Must be Alpha Numeric, standard ascii, and ${MIN_CHAR}-${MAX_CHAR} characters`,
      )
      .setRequired(true),
  );

async function execute(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString(NAME, true);

  const san = Sanitized(name);
  if (san !== FailedReason.None) {
    await interaction.reply({
      content: `Name Failed sanitization: ${sanitizedFilter[san]}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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

  try {
    insertAuthor.run(interaction.user.id, name, randomUUID());
  } catch (err) {
    if (
      err instanceof Database.SqliteError &&
      err.code.startsWith("SQLITE_CONSTRAINT")
    ) {
      if (err.message.includes("authors.author_name")) {
        await interaction.reply({
          content: `The name "${name}" is already taken, please choose a different one.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (err.message.includes("authors.discord_id")) {
        await interaction.reply({
          content: `You are already registered.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
    console.error(
      `[register] unexpected DB error for ${interaction.user.id}:`,
      err,
    );
    await interaction.reply({
      content: `Something went wrong registering your name. Please try again later.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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

export const sanitizedFilter: Record<FailedReason, string> = {
  [FailedReason.None]: "Valid",
  [FailedReason.DisallowedCharacter]:
    "Only letters, numbers, and -, and _ are allowed characters",
  [FailedReason.TooLong]: `Names must be shorter than ${MAX_CHAR} characters`,
  [FailedReason.TooShort]: `Names must be LONGER than ${MIN_CHAR} characters`,
};

function Sanitized(name: string): FailedReason {
  if (name.length > MAX_CHAR) {
    return FailedReason.TooLong;
  } else if (name.length < MIN_CHAR) {
    return FailedReason.TooShort;
  } else if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return FailedReason.DisallowedCharacter;
  }
  return FailedReason.None;
}

export const RegisterName = {
  data,
  execute,
};

import {
  MessageFlags,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { ReasonInvalid, ReasonMessages, Validate } from "../config/validate.js";

const FILE = "file";
const data = new SlashCommandBuilder()
  .setName("submit-config")
  .setDescription(
    "Submit a config file for publishing. (Requests are reviewed Daily-ish)",
  )
  .addAttachmentOption((option) =>
    option.setName(FILE).setDescription("File to submit").setRequired(true),
  );

async function execute(interaction: ChatInputCommandInteraction) {
  const file = interaction.options.getAttachment(FILE);

  if (file === null) {
    await interaction.reply({
      content: `Error! Please ping staff or try again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // validate
  const { reason, line, errors } = await Validate(file);
  if (reason !== ReasonInvalid.None) {
    let content;
    if (errors?.length) {
      const str = errors
        .map((e) => `${e.instancePath || "/"}: ${e.message ?? "unknown error"}`)
        .join("\n");
      content = `Error validating against schema:\n\`\`\`\n${str}\n\`\`\``;
    } else {
      content = `Error validating: ${ReasonMessages[reason]}`;
    }
    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // confirm submission
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("confirm")
      .setLabel("Submit")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger),
  );

  const response = await interaction.reply({
    content: `${file.name} appears valid, submit for publishing?`,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  try {
    const click = await response.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id,
      time: 30_000,
    });

    if (click.customId === "confirm") {
      // TODO: download file, create PR, etc.
      await click.update({
        content: `Submitted **${file.name}** for review!`,
        components: [],
      });
    } else {
      await click.update({ content: "Submission cancelled.", components: [] });
    }
  } catch {
    await interaction.editReply({
      content: "Timed out — submission cancelled.",
      components: [],
    });
  }
}

export const FileSubmit = {
  data,
  execute,
};

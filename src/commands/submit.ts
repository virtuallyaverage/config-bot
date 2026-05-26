import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";


const FILE = "file";
const data = new SlashCommandBuilder()
    .setName("submit-config")
    .setDescription("Submit a config file for publishing. (Requests are reviewed Daily-ish)")
    .addAttachmentOption((option) => option.setName(FILE).setDescription("File to submit").setRequired(true));

async function execute(interaction: ChatInputCommandInteraction) {
    const file = interaction.options.getAttachment(FILE);

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


    await interaction.reply({
        content: `Received: ${file?.name}`,
        flags: MessageFlags.Ephemeral
    });
}

export const FileSubmit = {
    data,
    execute
}
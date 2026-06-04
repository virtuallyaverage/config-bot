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
import {
  findVersion,
  QueueError,
  queueMap,
  type MapRef,
} from "../config/local.js";
import { extractMapRef, setAuthorName, setVersion } from "../config/schema.js";
import { getAuthorName } from "../db.js"; 

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
  const attachment = interaction.options.getAttachment(FILE);

  if (attachment === null) {
    await interaction.reply({
      content: `Error! Please ping staff or try again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // validate
  const { reason, errors, file } = await Validate(attachment);
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
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return;
  }

  // confirm submission
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("confirm").setLabel("Submit").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger),
  );

  const response = await interaction.reply({
    content: `${attachment.name} appears valid, submit for publishing?`,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  const filter = (i: { user: { id: string } }) =>
    i.user.id === interaction.user.id;

  try {
    const click = await response.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter,
      time: 30_000,
    });
    await click.deferUpdate(); // acknowledge within 3s

    if (file === null) {
      console.log("File returned null");
      return;
    }

    // if cancelled return
    if (click.customId !== "confirm") {
      await interaction.editReply({ content: "Submission cancelled.", components: [] });
      return;
    }

    const ref = extractMapRef(file);

    // Author ownership: the map's authorName is authoritative, but a user may
    // only publish under the name registered to their discord id. If the map's
    // author isn't theirs, offer to rewrite it to their registered name.
    const registered = getAuthorName(interaction.user.id);
    if (registered === null) {
      await interaction.editReply({
        content: "You haven't registered an author name yet. Run `/register` first.",
        components: [],
      });
      return;
    }

    if (ref.authorName !== registered) {
      const renameRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("rename")
          .setLabel(`Rename to "${registered}"`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Danger),
      );

      await interaction.editReply({
        content: `This map's author is **${ref.authorName}**, but your registered name is **${registered}**. Rename the map to publish under your name?`,
        components: [renameRow],
      });

      const renameClick = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter,
        time: 30_000,
      });
      await renameClick.deferUpdate();

      if (renameClick.customId !== "rename") {
        await interaction.editReply({ content: "Submission cancelled.", components: [] });
        return;
      }

      setAuthorName(file, registered); // ground-truth name now matches ownership
      ref.authorName = registered;
    }

    let res = await queueMap(false, file, ref);

    // already in queue -> ask to overwrite
    if (res === QueueError.InQueue) {
      const overWriteCached =
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("overwrite")
            .setLabel("Overwrite File")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Success),
        );

      await interaction.editReply({
        content: `Your map with the same version isn't published yet, overwrite it?`,
        components: [overWriteCached],
      });

      const next = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter,
        time: 30_000,
      });
      await next.deferUpdate(); // acknowledge within 3s

      if (next.customId !== "overwrite") {
        await interaction.editReply({ content: `Canceled`, components: [] });
        return;
      }
      res = await queueMap(true, file, ref);
    }

    // name+version already exists -> ask to increment
    if (res === QueueError.Duplicate) {
      const increment = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("newversion")
          .setLabel("New Version")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Success),
      );

      await interaction.editReply({
        content: `A map already exists under this name and version. Increment the version?`,
        components: [increment],
      });

      const next = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter,
        time: 30_000,
      });
      await next.deferUpdate(); // acknowledge within 3s

      if (next.customId !== "newversion") {
        await interaction.editReply({ content: `Canceled`, components: [] });
        return;
      }
      const max_ver = await findVersion(ref.authorName, ref.mapName);
      if (!max_ver) {
        throw new Error("Unable to find version");
      }
      ref.version = max_ver + 1;
      setVersion(file, ref.version); // keep the map file's mapVersion in sync with the ref
      res = await queueMap(true, file, ref); // already confirmed to overwrite
    }

    if (res === QueueError.None) {
      await interaction.editReply({
        content: `Submitted **${attachment.name}** for review!`,
        components: [],
      });
    } else {
      // any unhandled state still resolves the interaction
      await interaction.editReply({
        content: `Submission failed (code: ${res}).`,
        components: [],
      });
    }
  } catch {
    await interaction.editReply({
      content: "Timed out; submission cancelled.",
      components: [],
    });
  }
}

export const FileSubmit = {
  data,
  execute,
};

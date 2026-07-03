import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from './config.js';
import { log } from './logger.js';
import { CallSession } from './callSession.js';
import { ConversationManager } from './conversationManager.js';
import { initDatabase, closeDatabase } from './database.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

// guildId -> CallSession
const activeSessions = new Map();

// guildId -> textChannelId (for dote channels)
const doteChannels = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your current voice channel and start transcribing'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the voice channel and stop transcribing'),
  new SlashCommandBuilder()
    .setName('dote-channel')
    .setDescription('Create a text channel to chat with Dote about conversations')
    .addStringOption(option =>
      option
        .setName('name')
        .setDescription('Name for the Dote channel')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('dote-search')
    .setDescription('Search through past conversations')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('Search query')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('dote-recent')
    .setDescription('Show recent conversations'),
  new SlashCommandBuilder()
    .setName('dote-important')
    .setDescription('Show most important conversations'),
  new SlashCommandBuilder()
    .setName('dote-reset')
    .setDescription('Reset the AI context memory for this channel'),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  if (config.discordGuildIds.length > 0) {
    for (const guildId of config.discordGuildIds) {
      await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, guildId),
        { body: commands }
      );
      log.info(`Registered commands for guild ${guildId}`);
    }
  } else {
    await rest.put(Routes.applicationCommands(config.discordClientId), {
      body: commands,
    });
    log.info('Registered global commands (may take up to 1hr to propagate)');
  }
}

client.once('ready', async () => {
  log.info(`Logged in as ${client.user.tag}`);
  initDatabase();
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'join':
      await handleJoin(interaction);
      break;
    case 'leave':
      await handleLeave(interaction);
      break;
    case 'dote-channel':
      await handleDoteChannel(interaction);
      break;
    case 'dote-search':
      await handleDoteSearch(interaction);
      break;
    case 'dote-recent':
      await handleDoteRecent(interaction);
      break;
    case 'dote-important':
      await handleDoteImportant(interaction);
      break;
    case 'dote-reset':
      await handleDoteReset(interaction);
      break;
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const doteChannelId = doteChannels.get(message.guildId);
  if (doteChannelId && message.channelId === doteChannelId) {
    try {
      await ConversationManager.handleTextChannelMessage(message);
    } catch (err) {
      log.error('Error handling Dote channel message:', err);
      await message.reply('Sorry, I encountered an error processing your message.');
    }
  }
});

async function handleJoin(interaction) {
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await interaction.reply({
      content: "You need to be in a voice channel for me to join.",
      ephemeral: true,
    });
    return;
  }

  if (activeSessions.has(interaction.guildId)) {
    await interaction.reply({
      content: "I'm already recording a call in this server. Use `/leave` first.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const session = new CallSession(voiceChannel, client);
    session.onEnded = () => activeSessions.delete(interaction.guildId);
    await session.start();
    activeSessions.set(interaction.guildId, session);

    await interaction.editReply(
      `Joined **${voiceChannel.name}** and started transcribing. Use \`/leave\` when you're done.`
    );
  } catch (err) {
    log.error('Failed to join voice channel:', err);
    await interaction.editReply(`Failed to join: ${err.message}`);
  }
}

async function handleLeave(interaction) {
  const session = activeSessions.get(interaction.guildId);

  if (!session) {
    await interaction.reply({
      content: "I'm not currently in a voice channel here.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();
  await session.stop('manual_leave');
  activeSessions.delete(interaction.guildId);
  await interaction.editReply('Left the voice channel. Conversation saved and processed.');
}

async function handleDoteChannel(interaction) {
  const member = interaction.member;
  const channelName = interaction.options.getString('name').toLowerCase().replace(/\s+/g, '-');

  if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({
      content: "You need the Manage Channels permission to create a Dote channel.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const channel = await interaction.guild.channels.create({
      name: `dote-${channelName}`,
      type: ChannelType.GuildText,
      topic: `Chat with Dote about your conversations. Created by ${member.displayName}`,
    });

    doteChannels.set(interaction.guildId, channel.id);

    await interaction.editReply(
      `Created ${channel}! Use this channel to chat with Dote about your conversations.\n` +
      `I can help you search, summarize, and find information from past voice calls.`
    );

    log.info(`Created Dote channel ${channel.name} in guild ${interaction.guild.name}`);
  } catch (err) {
    log.error('Failed to create Dote channel:', err);
    await interaction.editReply(`Failed to create channel: ${err.message}`);
  }
}

async function handleDoteSearch(interaction) {
  const query = interaction.options.getString('query');
  await interaction.deferReply();

  const conversations = ConversationManager.searchConversationsForGuild(interaction.guildId, query);

  if (conversations.length === 0) {
    await interaction.editReply(`No conversations found matching "${query}".`);
    return;
  }

  const results = conversations.map((conv, i) =>
    `**${i + 1}. ${conv.title || 'Untitled'}** (${conv.importance}/10)\n` +
    `Description: ${conv.description || 'No description'}\n` +
    `Date: ${new Date(conv.started_at).toLocaleDateString()}`
  ).join('\n\n');

  await interaction.editReply(`Found ${conversations.length} conversation(s):\n\n${results}`);
}

async function handleDoteRecent(interaction) {
  await interaction.deferReply();

  const conversations = ConversationManager.getRecentConversationsForGuild(interaction.guildId);

  if (conversations.length === 0) {
    await interaction.editReply('No conversations found yet.');
    return;
  }

  const results = conversations.map((conv, i) =>
    `**${i + 1}. ${conv.title || 'Untitled'}** (${conv.importance}/10)\n` +
    `Description: ${conv.description || 'No description'}\n` +
    `Date: ${new Date(conv.started_at).toLocaleDateString()}`
  ).join('\n\n');

  await interaction.editReply(`Recent conversations:\n\n${results}`);
}

async function handleDoteImportant(interaction) {
  await interaction.deferReply();

  const conversations = ConversationManager.getImportantConversationsForGuild(interaction.guildId);

  if (conversations.length === 0) {
    await interaction.editReply('No important conversations found yet.');
    return;
  }

  const results = conversations.map((conv, i) =>
    `**${i + 1}. ${conv.title || 'Untitled'}** (${conv.importance}/10)\n` +
    `Description: ${conv.description || 'No description'}\n` +
    `Date: ${new Date(conv.started_at).toLocaleDateString()}`
  ).join('\n\n');

  await interaction.editReply(`Most important conversations:\n\n${results}`);
}

async function handleDoteReset(interaction) {
  await interaction.deferReply();

  ConversationManager.resetChannelContext(interaction.channelId);

  await interaction.editReply('Context memory reset. I\'ll start fresh with the next message.');
}

process.on('SIGTERM', async () => {
  log.info('SIGTERM received, cleaning up...');
  await Promise.all([...activeSessions.values()].map((s) => s.stop('shutdown')));
  closeDatabase();
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  log.info('SIGINT received, cleaning up...');
  await Promise.all([...activeSessions.values()].map((s) => s.stop('shutdown')));
  closeDatabase();
  client.destroy();
  process.exit(0);
});

client.login(config.discordToken);

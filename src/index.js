import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from './config.js';
import { log } from './logger.js';
import { CallSession } from './callSession.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// guildId -> CallSession
const activeSessions = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your current voice channel and start transcribing'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the voice channel and stop transcribing'),
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
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'join') {
    await handleJoin(interaction);
  } else if (interaction.commandName === 'leave') {
    await handleLeave(interaction);
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
  await interaction.editReply('Left the voice channel. Transcript sent to n8n.');
}

process.on('SIGTERM', async () => {
  log.info('SIGTERM received, cleaning up active sessions...');
  await Promise.all([...activeSessions.values()].map((s) => s.stop('shutdown')));
  client.destroy();
  process.exit(0);
});

client.login(config.discordToken);

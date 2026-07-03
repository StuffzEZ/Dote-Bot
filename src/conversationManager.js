import { log } from './logger.js';
import {
  createConversation,
  endConversation,
  updateConversationMetadata,
  addSegment,
  addTag,
  getConversation,
  getConversationSegments,
  getConversationTags,
  getConversationsByGuild,
  getConversationsByTextChannel,
  searchConversations,
  getImportantConversations,
  getRecentConversations
} from './database.js';
import { generateConversationMetadata, chatWithMemory } from './openrouter.js';

export class ConversationManager {
  static activeConversations = new Map();

  static startConversation({ guildId, voiceChannelId, textChannelId }) {
    const id = `${guildId}-${voiceChannelId || 'text'}-${Date.now()}`;
    const startedAt = new Date().toISOString();

    createConversation({
      id,
      guildId,
      voiceChannelId,
      textChannelId,
      startedAt
    });

    const conversation = {
      id,
      guildId,
      voiceChannelId,
      textChannelId,
      startedAt,
      segments: []
    };

    this.activeConversations.set(id, conversation);
    log.info(`Started conversation ${id}`);
    return conversation;
  }

  static addSegmentToConversation(conversationId, segment) {
    const conversation = this.activeConversations.get(conversationId);
    if (!conversation) {
      log.warn(`Conversation ${conversationId} not found in active conversations`);
      return;
    }

    conversation.segments.push(segment);

    addSegment({
      conversationId,
      userId: segment.userId,
      username: segment.username,
      startTime: segment.startTime,
      endTime: segment.endTime,
      text: segment.text
    });
  }

  static async endConversationAndProcess(conversationId) {
    const conversation = this.activeConversations.get(conversationId);
    if (!conversation) {
      log.warn(`Conversation ${conversationId} not found`);
      return null;
    }

    const endedAt = new Date().toISOString();
    endConversation({ id: conversationId, endedAt });

    const dbConversation = getConversation(conversationId);
    const segments = getConversationSegments(conversationId);

    if (segments.length > 0) {
      const metadata = await generateConversationMetadata(segments);
      updateConversationMetadata({
        id: conversationId,
        title: metadata.title || `Conversation ${new Date(conversation.startedAt).toLocaleString()}`,
        description: metadata.description || 'No description generated',
        importance: metadata.importance || 0
      });
      dbConversation.title = metadata.title;
      dbConversation.description = metadata.description;
      dbConversation.importance = metadata.importance;
    }

    this.activeConversations.delete(conversationId);
    log.info(`Ended conversation ${conversationId}`);
    return dbConversation;
  }

  static async handleTextChannelMessage(message) {
    const { guildId, channel.id: channelId, content, author } = message;

    if (author.bot) return;

    const conversations = getConversationsByTextChannel(channelId);
    if (conversations.length === 0) return;

    const context = this.formatConversationsForContext(conversations);

    const response = await chatWithMemory(
      [{ role: 'user', content }],
      context
    );

    await message.reply(response);
  }

  static formatConversationsForContext(conversations) {
    return conversations.map(conv => {
      const segments = getConversationSegments(conv.id);
      const tags = getConversationTags(conv.id);
      const transcript = segments.map(s => `${s.username}: ${s.text}`).join('\n');

      return `Conversation: ${conv.title || 'Untitled'}
Description: ${conv.description || 'No description'}
Importance: ${conv.importance}/10
Tags: ${tags.length > 0 ? tags.join(', ') : 'None'}
Date: ${conv.started_at}
Transcript:
${transcript}
---`;
    }).join('\n\n');
  }

  static searchConversationsForGuild(guildId, query) {
    return searchConversations(guildId, query);
  }

  static getConversationsForGuild(guildId) {
    return getConversationsByGuild(guildId);
  }

  static getImportantConversationsForGuild(guildId) {
    return getImportantConversations(guildId);
  }

  static getRecentConversationsForGuild(guildId) {
    return getRecentConversations(guildId);
  }
}

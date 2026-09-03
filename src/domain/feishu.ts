export type FeishuMessageEvent = {
  chatId: string;
  chatType: 'group' | 'p2p' | string;
  mentions: Array<{
    key: string;
    openId: string | null;
  }>;
  messageId: string;
  messageType: string;
  openId: string | null;
  rawText: string;
};

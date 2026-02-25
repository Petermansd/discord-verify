import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} from 'discord.js';

const {
  BOT_TOKEN,
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  GUILD_ID,
  VERIFY_ROLE_ID,
  LOG_CHANNEL_ID,
  PORT = 3000,
} = process.env;

if (!BOT_TOKEN || !CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !GUILD_ID || !VERIFY_ROLE_ID || !LOG_CHANNEL_ID) {
  console.error('Missing environment variables.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const app = express();

client.once('ready', () => console.log(`Bot online: ${client.user.tag}`));

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setupverify') {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'You need admin permission.', ephemeral: true });
    }

    const oauthUrl =
      `https://discord.com/oauth2/authorize` +
      `?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=identify%20email`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Verify').setStyle(ButtonStyle.Link).setURL(oauthUrl)
    );

    await interaction.channel.send({
      content: 'Click Verify and authorize Discord.',
      components: [row],
    });

    return interaction.reply({ content: 'Verify message sent.', ephemeral: true });
  }
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code received.');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: REDIRECT_URI,
      }),
    });

    const token = await tokenRes.json();
    if (!token.access_token) return res.status(400).send('Token error.');

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const user = await userRes.json();

    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(user.id).catch(() => null);
    const logCh = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

    if (member) {
      await member.roles.add(VERIFY_ROLE_ID).catch(() => {});
    }

    if (logCh?.isTextBased()) {
      logCh.send(
        `Verified: ${user.username} (${user.id})\nEmail: ${user.email ?? 'not granted'}`
      );
    }

    res.send('Verified successfully. You can return to Discord.');
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error.');
  }
});

app.get('/', (req, res) => res.send('OK'));

async function registerCommands() {
  const url = `https://discord.com/api/v10/applications/${CLIENT_ID}/commands`;
  await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: 'setupverify', description: 'Send verify message' }]),
  });
}
registerCommands().catch(console.error);

app.listen(Number(PORT), () => console.log(`Web running on ${PORT}`));
client.login(BOT_TOKEN);

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

function must(name) {
  if (!process.env[name]) {
    console.error(`Missing ENV: ${name}`);
    process.exit(1);
  }
}

must('BOT_TOKEN');
must('CLIENT_ID');
must('CLIENT_SECRET');
must('REDIRECT_URI');
must('GUILD_ID');
must('VERIFY_ROLE_ID');
must('LOG_CHANNEL_ID');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const app = express();

client.once('ready', () => console.log(`Bot online: ${client.user.tag}`));

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setupverify') {
    try {
      // IMPORTANT: respond fast to avoid "Unknown interaction"
      await interaction.deferReply({ ephemeral: true });

      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply('❌ Du brauchst Admin-Rechte.');
      }

      const oauthUrl =
        `https://discord.com/oauth2/authorize` +
        `?client_id=${CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=identify%20email`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('✅ Verifizieren').setStyle(ButtonStyle.Link).setURL(oauthUrl)
      );

      await interaction.channel.send({
        content:
          '**Verifizierung**\n' +
          'Klicke auf **Verifizieren** und autorisiere Discord.\n' +
          'ICE CRIMELIFE.',
        components: [row],
      });

      return interaction.editReply('✅ Verify-Message gesendet.');
    } catch (err) {
      console.error(err);
      if (interaction.deferred) {
        return interaction.editReply('❌ Fehler beim Setup. Prüfe Bot-Rechte im Channel (Nachrichten senden).');
      }
      return;
    }
  }
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code received.');

  try {
    // Exchange code for access token
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
    if (!token.access_token) return res.status(400).send('Token error. Check Redirect URI + Client Secret.');

    // Fetch user (email only present if scope=email and user consented)
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
        `✅ **Verified**\n` +
        `User: <@${user.id}> (${user.username})\n` +
        `ID: ${user.id}\n` +
        `Email: ${user.email ?? 'not granted'}`
      );
    }

    res.send('✅ Verifiziert! Du kannst zurück zu Discord.');
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error.');
  }
});

app.get('/', (req, res) => res.send('OK'));

// Register /setupverify as a global command
async function registerCommands() {
  const url = `https://discord.com/api/v10/applications/${CLIENT_ID}/commands`;
  await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: 'setupverify', description: 'Sendet eine Verify-Message' }]),
  });
}
registerCommands().catch(console.error);

app.listen(Number(PORT), () => console.log(`Web running on ${PORT}`));
client.login(BOT_TOKEN);

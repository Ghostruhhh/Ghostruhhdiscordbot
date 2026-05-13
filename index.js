const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Missing DISCORD_TOKEN. Set it in Pebble environment variables.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(token);
  const commands = [{ name: "ping", description: "Replies with Pong!" }];

  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log("Slash commands registered (global; may take a few minutes to show).");
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "ping") {
    await interaction.reply("Pong!");
  }
});

client.login(token);
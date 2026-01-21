import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { readFileSync, writeFileSync } from "fs";
import * as path from "path";
import * as os from "os";

const PROGRAM_ID = new PublicKey("DSQt1z5wNcmE5h2XL1K1QAWHy28iJufg52aGy3kn8pEc");

// IDL for Velo Mixer
const IDL = {
  version: "0.1.0",
  name: "velo_mixer",
  metadata: {
    address: "DSQt1z5wNcmE5h2XL1K1QAWHy28iJufg52aGy3kn8pEc"
  },
  instructions: [
    {
      name: "initializePool",
      accounts: [
        { name: "mixerPool", isMut: true, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false }
      ],
      args: [{ name: "denomination", type: "u64" }]
    },
    {
      name: "deposit",
      accounts: [
        { name: "mixerPool", isMut: true, isSigner: false },
        { name: "poolVault", isMut: true, isSigner: false },
        { name: "depositor", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false }
      ],
      args: [{ name: "commitment", type: { array: ["u8", 32] } }]
    },
    {
      name: "withdraw",
      accounts: [
        { name: "mixerPool", isMut: false, isSigner: false },
        { name: "poolVault", isMut: true, isSigner: false },
        { name: "recipient", isMut: true, isSigner: false }
      ],
      args: [{ name: "nullifier", type: { array: ["u8", 32] } }]
    }
  ],
  accounts: [
    {
      name: "MixerPool",
      type: {
        kind: "struct",
        fields: [
          { name: "authority", type: "publicKey" },
          { name: "denomination", type: "u64" },
          { name: "nextIndex", type: "u32" },
          { name: "totalDeposits", type: "u64" }
        ]
      }
    }
  ],
  errors: []
};

async function main() {
  console.log("🔧 Preparing IDL for Velo Privacy Protocol...");
  
  // Save IDL to file
  const idlPath = path.join(__dirname, "..", "target", "idl", "velo_mixer.json");
  writeFileSync(idlPath, JSON.stringify(IDL, null, 2));
  console.log(`📝 IDL saved to: ${idlPath}`);
  
  console.log(`
📋 To upload the IDL, run this command in WSL when network is stable:

cd /home/freemell/velo_idl
anchor idl init DSQt1z5wNcmE5h2XL1K1QAWHy28iJufg52aGy3kn8pEc \\
    --filepath /mnt/c/Users/1/Documents/milla\\ projects/velo/target/idl/velo_mixer.json \\
    --provider.cluster devnet

Or use anchor idl upgrade if it already exists.

Once uploaded, Solscan will show "velo_mixer" as the program name!
  `);
}

main().catch(console.error);

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { A2aSwap } from "../target/types/a2a_swap";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expect } from "chai";

// ─── Mirror Rust constants ───────────────────────────────────────────────────
const PROTOCOL_FEE_BPS = 20n;
const PROTOCOL_FEE_DENOM = 100_000n;
const LP_FEE_BPS = 30n;
const BPS_DENOM = 10_000n;

/** Replicate integer swap math from swap.rs (bigint = floor division like Rust) */
function swapCalc(
  reserveIn: bigint,
  reserveOut: bigint,
  amtIn: bigint,
  lpFeeBps = LP_FEE_BPS
) {
  const proto = (amtIn * PROTOCOL_FEE_BPS) / PROTOCOL_FEE_DENOM;
  const net = amtIn - proto;
  const lpFee = (net * lpFeeBps) / BPS_DENOM;
  const afterFees = net - lpFee;
  const out = (reserveOut * afterFees) / (reserveIn + afterFees);
  return { proto, lpFee, net, out };
}

/** Integer square root (Babylonian) — mirrors provide_liquidity.rs */
function isqrt(n: bigint): bigint {
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (y + n / y) >> 1n; }
  return x;
}

/** Read SPL token account balance as bigint */
async function bal(
  conn: anchor.web3.Connection,
  addr: PublicKey
): Promise<bigint> {
  return (await getAccount(conn, addr)).amount;
}

// ─── Suite ───────────────────────────────────────────────────────────────────
describe("a2a-swap", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.a2aSwap as Program<A2aSwap>;
  const conn = provider.connection;

  // ── Persistent keypairs ───────────────────────────────────────────────────
  const agent         = Keypair.generate();
  const approver      = Keypair.generate();
  const vaultAKp      = Keypair.generate();
  const vaultBKp      = Keypair.generate();
  // Explicit keypairs for treasury token accounts (PDA owner is off-curve)
  const treasuryATAKp = Keypair.generate();
  const treasuryBTAKp = Keypair.generate();

  // ── Addresses set in before() ─────────────────────────────────────────────
  let mintA: PublicKey;
  let mintB: PublicKey;
  let agentATA: PublicKey;  // agent's token-A account
  let agentBTA: PublicKey;  // agent's token-B account
  let poolPda: PublicKey;
  let poolAuthPda: PublicKey;
  let treasuryPda: PublicKey;
  let treasuryATA: PublicKey; // treasury's token-A account
  let treasuryBTA: PublicKey; // treasury's token-B account
  let positionPda: PublicKey;

  const INIT_A = 10_000_000n; // initial liquidity seed
  const INIT_B = 10_000_000n;

  // ─── Global setup ──────────────────────────────────────────────────────────
  before("fund accounts, create mints, init pool", async () => {
    // Airdrop SOL to agent and approver
    await conn.confirmTransaction(
      await conn.requestAirdrop(agent.publicKey, 10 * LAMPORTS_PER_SOL),
      "confirmed"
    );
    await conn.confirmTransaction(
      await conn.requestAirdrop(approver.publicKey, 2 * LAMPORTS_PER_SOL),
      "confirmed"
    );

    // Mints with 0 decimals — easy integer math
    mintA = await createMint(conn, agent, agent.publicKey, null, 0);
    mintB = await createMint(conn, agent, agent.publicKey, null, 0);

    // Agent token accounts
    agentATA = await createAccount(conn, agent, mintA, agent.publicKey);
    agentBTA = await createAccount(conn, agent, mintB, agent.publicKey);
    await mintTo(conn, agent, mintA, agentATA, agent, 1_000_000_000);
    await mintTo(conn, agent, mintB, agentBTA, agent, 1_000_000_000);

    // PDAs
    [poolPda]     = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mintA.toBuffer(), mintB.toBuffer()], program.programId);
    [poolAuthPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_authority"), poolPda.toBuffer()], program.programId);
    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")], program.programId);
    [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), poolPda.toBuffer(), agent.publicKey.toBuffer()],
      program.programId);

    // Initialize pool — vaults are created here via `init`
    await program.methods
      .initializePool(30)
      .accounts({
        creator:       agent.publicKey,
        tokenAMint:    mintA,
        tokenBMint:    mintB,
        pool:          poolPda,
        poolAuthority: poolAuthPda,
        tokenAVault:   vaultAKp.publicKey,
        tokenBVault:   vaultBKp.publicKey,
        tokenProgram:  TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent:          SYSVAR_RENT_PUBKEY,
      })
      .signers([agent, vaultAKp, vaultBKp])
      .rpc();

    // Treasury token accounts — owned by the treasury PDA.
    // Must use explicit keypairs because treasuryPda is off-curve (a PDA).
    treasuryATA = await createAccount(conn, agent, mintA, treasuryPda, treasuryATAKp);
    treasuryBTA = await createAccount(conn, agent, mintB, treasuryPda, treasuryBTAKp);
  });

  // ─── 1. Pool state ─────────────────────────────────────────────────────────
  it("initialize_pool: pool has correct fee, mints, and empty vaults", async () => {
    const pool = await program.account.pool.fetch(poolPda);

    expect(pool.feeRateBps).to.equal(30);
    expect(pool.tokenAMint.toBase58()).to.equal(mintA.toBase58());
    expect(pool.tokenBMint.toBase58()).to.equal(mintB.toBase58());
    expect(pool.tokenAVault.toBase58()).to.equal(vaultAKp.publicKey.toBase58());
    expect(pool.tokenBVault.toBase58()).to.equal(vaultBKp.publicKey.toBase58());
    expect(pool.lpSupply.isZero()).to.be.true;

    expect(await bal(conn, vaultAKp.publicKey)).to.equal(0n);
    expect(await bal(conn, vaultBKp.publicKey)).to.equal(0n);
  });

  // ─── 2. First liquidity deposit ────────────────────────────────────────────
  it("provide_liquidity: first deposit mints sqrt(a*b) LP shares", async () => {
    const amtA = INIT_A;
    const amtB = INIT_B;
    const expectedLp = isqrt(amtA * amtB); // = 10_000_000n

    await program.methods
      .provideLiquidity(
        new BN(amtA.toString()),
        new BN(amtB.toString()),
        new BN(0),   // min_lp
        false,       // auto_compound
        new BN(0),   // compound_threshold
      )
      .accounts({
        agent:         agent.publicKey,
        pool:          poolPda,
        poolAuthority: poolAuthPda,
        position:      positionPda,
        tokenAVault:   vaultAKp.publicKey,
        tokenBVault:   vaultBKp.publicKey,
        agentTokenA:   agentATA,
        agentTokenB:   agentBTA,
        tokenProgram:  TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent:          SYSVAR_RENT_PUBKEY,
      })
      .signers([agent])
      .rpc();

    const pool = await program.account.pool.fetch(poolPda);
    const pos  = await program.account.position.fetch(positionPda);

    expect(pool.lpSupply.toString()).to.equal(expectedLp.toString());
    expect(pos.lpShares.toString()).to.equal(expectedLp.toString());
    expect(pos.autoCompound).to.equal(false);
    expect(await bal(conn, vaultAKp.publicKey)).to.equal(amtA);
    expect(await bal(conn, vaultBKp.publicKey)).to.equal(amtB);
  });

  // ─── 3. Swap a→b ───────────────────────────────────────────────────────────
  it("swap a→b: protocol fee to treasury, LP fee in vault, correct output", async () => {
    const amtIn = 1_000_000n;
    const { proto, net, out } = swapCalc(INIT_A, INIT_B, amtIn);

    const agentABefore    = await bal(conn, agentATA);
    const agentBBefore    = await bal(conn, agentBTA);
    const treasuryBefore  = await bal(conn, treasuryATA);
    const vaultABefore    = await bal(conn, vaultAKp.publicKey);
    const vaultBBefore    = await bal(conn, vaultBKp.publicKey);

    await program.methods
      .swap(new BN(amtIn.toString()), new BN(0), true)
      .accounts({
        agent:           agent.publicKey,
        pool:            poolPda,
        poolAuthority:   poolAuthPda,
        tokenAVault:     vaultAKp.publicKey,
        tokenBVault:     vaultBKp.publicKey,
        agentTokenIn:    agentATA,
        agentTokenOut:   agentBTA,
        treasury:        treasuryPda,
        treasuryTokenIn: treasuryATA,
        tokenProgram:    TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const agentAAfter   = await bal(conn, agentATA);
    const agentBAfter   = await bal(conn, agentBTA);
    const treasuryAfter = await bal(conn, treasuryATA);
    const vaultAAfter   = await bal(conn, vaultAKp.publicKey);
    const vaultBAfter   = await bal(conn, vaultBKp.publicKey);

    expect((agentABefore - agentAAfter).toString()).to.equal(amtIn.toString(),
      "agent paid full amtIn from token A");
    expect((agentBAfter - agentBBefore).toString()).to.equal(out.toString(),
      "agent received correct amount_out in token B");
    expect((treasuryAfter - treasuryBefore).toString()).to.equal(proto.toString(),
      "treasury received 0.02% protocol fee in token A");
    expect((vaultAAfter - vaultABefore).toString()).to.equal(net.toString(),
      "vault A gained net_pool_input (amtIn - protocolFee)");
    expect((vaultBBefore - vaultBAfter).toString()).to.equal(out.toString(),
      "vault B released amount_out");

    // fee_growth_global_a must be > 0 after a→b swap
    const pool = await program.account.pool.fetch(poolPda);
    expect(pool.feeGrowthGlobalA.isZero()).to.be.false;
    expect(pool.feeGrowthGlobalB.isZero()).to.be.true;
  });

  // ─── 4. Claim fees — manual ────────────────────────────────────────────────
  it("claim_fees manual: LP fee transferred to agent, fees_owed reset", async () => {
    const agentABefore = await bal(conn, agentATA);
    const agentBBefore = await bal(conn, agentBTA);

    await program.methods
      .claimFees()
      .accounts({
        agent:         agent.publicKey,
        pool:          poolPda,
        poolAuthority: poolAuthPda,
        position:      positionPda,
        tokenAVault:   vaultAKp.publicKey,
        tokenBVault:   vaultBKp.publicKey,
        agentTokenA:   agentATA,
        agentTokenB:   agentBTA,
        tokenProgram:  TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const agentAAfter = await bal(conn, agentATA);
    const agentBAfter = await bal(conn, agentBTA);

    // Agent should have received some token A (LP fee from the swap)
    expect(agentAAfter > agentABefore).to.be.true;
    // No token B fees yet (no b→a swap has occurred)
    expect(agentBAfter).to.equal(agentBBefore);

    // Position fees_owed reset to zero
    const pos = await program.account.position.fetch(positionPda);
    expect(pos.feesOwedA.isZero()).to.be.true;
    expect(pos.feesOwedB.isZero()).to.be.true;
  });

  // ─── 5. Second liquidity deposit — enable auto_compound ───────────────────
  it("provide_liquidity: second deposit with auto_compound=true, LP proportional", async () => {
    const pool0  = await program.account.pool.fetch(poolPda);
    const vaultA = await bal(conn, vaultAKp.publicKey);
    const vaultB = await bal(conn, vaultBKp.publicKey);
    const lpSup  = BigInt(pool0.lpSupply.toString());

    const amtA = 5_000_000n;
    const amtB = 5_000_000n;
    const lpA = (amtA * lpSup) / vaultA;
    const lpB = (amtB * lpSup) / vaultB;
    const expectedNewLp = lpA < lpB ? lpA : lpB;

    await program.methods
      .provideLiquidity(
        new BN(amtA.toString()),
        new BN(amtB.toString()),
        new BN(0),
        true,        // auto_compound = true
        new BN(1),   // compound_threshold = 1 (any fee triggers)
      )
      .accounts({
        agent:         agent.publicKey,
        pool:          poolPda,
        poolAuthority: poolAuthPda,
        position:      positionPda,
        tokenAVault:   vaultAKp.publicKey,
        tokenBVault:   vaultBKp.publicKey,
        agentTokenA:   agentATA,
        agentTokenB:   agentBTA,
        tokenProgram:  TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent:          SYSVAR_RENT_PUBKEY,
      })
      .signers([agent])
      .rpc();

    const pool1 = await program.account.pool.fetch(poolPda);
    const lpGained = BigInt(pool1.lpSupply.toString()) - lpSup;
    expect(lpGained.toString()).to.equal(expectedNewLp.toString());

    const pos = await program.account.position.fetch(positionPda);
    expect(pos.autoCompound).to.equal(true);
  });

  // ─── 6a. Swap a→b (small) — generate fee_growth_a ─────────────────────────
  it("swap a→b (small): sets fee_growth_a ahead of auto_compound test", async () => {
    const vA = await bal(conn, vaultAKp.publicKey);
    const vB = await bal(conn, vaultBKp.publicKey);
    const { proto } = swapCalc(vA, vB, 300_000n);
    const tBefore = await bal(conn, treasuryATA);

    await program.methods
      .swap(new BN(300_000), new BN(0), true)
      .accounts({
        agent:           agent.publicKey,
        pool:            poolPda,
        poolAuthority:   poolAuthPda,
        tokenAVault:     vaultAKp.publicKey,
        tokenBVault:     vaultBKp.publicKey,
        agentTokenIn:    agentATA,
        agentTokenOut:   agentBTA,
        treasury:        treasuryPda,
        treasuryTokenIn: treasuryATA,
        tokenProgram:    TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const tAfter = await bal(conn, treasuryATA);
    expect((tAfter - tBefore).toString()).to.equal(proto.toString(),
      "treasury still receives 0.02% on small a→b swap");
  });

  // ─── 6b. Swap b→a — generate fee_growth_b ─────────────────────────────────
  it("swap b→a: protocol fee to treasury in token B", async () => {
    const vA = await bal(conn, vaultAKp.publicKey);
    const vB = await bal(conn, vaultBKp.publicKey);
    const amtIn = 300_000n;
    // b→a: reserveIn = vaultB, reserveOut = vaultA
    const { proto, net, out } = swapCalc(vB, vA, amtIn);

    const tBefore     = await bal(conn, treasuryBTA);
    const agentABefore = await bal(conn, agentATA);
    const agentBBefore = await bal(conn, agentBTA);

    await program.methods
      .swap(new BN(amtIn.toString()), new BN(0), false) // a_to_b = false
      .accounts({
        agent:           agent.publicKey,
        pool:            poolPda,
        poolAuthority:   poolAuthPda,
        tokenAVault:     vaultAKp.publicKey,
        tokenBVault:     vaultBKp.publicKey,
        agentTokenIn:    agentBTA,          // selling B
        agentTokenOut:   agentATA,          // receiving A
        treasury:        treasuryPda,
        treasuryTokenIn: treasuryBTA,       // treasury gets B
        tokenProgram:    TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const tAfter      = await bal(conn, treasuryBTA);
    const agentAAfter  = await bal(conn, agentATA);
    const agentBAfter  = await bal(conn, agentBTA);

    expect((tAfter - tBefore).toString()).to.equal(proto.toString(),
      "treasury received 0.02% in token B");
    expect((agentBBefore - agentBAfter).toString()).to.equal(amtIn.toString());
    expect((agentAAfter - agentABefore).toString()).to.equal(out.toString());

    const pool = await program.account.pool.fetch(poolPda);
    expect(pool.feeGrowthGlobalB.isZero()).to.be.false;
  });

  // ─── 7. Claim fees — auto_compound ────────────────────────────────────────
  it("claim_fees auto_compound: fees reinvested as new LP shares", async () => {
    const pool0 = await program.account.pool.fetch(poolPda);
    const pos0  = await program.account.position.fetch(positionPda);
    const lpSupBefore    = BigInt(pool0.lpSupply.toString());
    const lpSharesBefore = BigInt(pos0.lpShares.toString());

    const agentABefore = await bal(conn, agentATA);
    const agentBBefore = await bal(conn, agentBTA);

    await program.methods
      .claimFees()
      .accounts({
        agent:         agent.publicKey,
        pool:          poolPda,
        poolAuthority: poolAuthPda,
        position:      positionPda,
        tokenAVault:   vaultAKp.publicKey,
        tokenBVault:   vaultBKp.publicKey,
        agentTokenA:   agentATA,
        agentTokenB:   agentBTA,
        tokenProgram:  TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const pool1 = await program.account.pool.fetch(poolPda);
    const pos1  = await program.account.position.fetch(positionPda);
    const lpSupAfter    = BigInt(pool1.lpSupply.toString());
    const lpSharesAfter = BigInt(pos1.lpShares.toString());

    // LP supply and shares must have increased (compounded)
    expect(lpSupAfter > lpSupBefore).to.be.true;
    expect(lpSharesAfter > lpSharesBefore).to.be.true;

    // Tokens should NOT have left the vaults (no transfer on auto_compound)
    const agentAAfter = await bal(conn, agentATA);
    const agentBAfter = await bal(conn, agentBTA);
    expect(agentAAfter).to.equal(agentABefore);
    expect(agentBAfter).to.equal(agentBBefore);

    // fees_owed reset
    expect(pos1.feesOwedA.isZero()).to.be.true;
    expect(pos1.feesOwedB.isZero()).to.be.true;
  });

  // ─── 8. approve_and_execute ────────────────────────────────────────────────
  it("approve_and_execute: both sigs required, protocol fee goes to treasury", async () => {
    const vA = await bal(conn, vaultAKp.publicKey);
    const vB = await bal(conn, vaultBKp.publicKey);
    const amtIn = 200_000n;
    const { proto, out } = swapCalc(vA, vB, amtIn);

    const agentABefore   = await bal(conn, agentATA);
    const agentBBefore   = await bal(conn, agentBTA);
    const treasuryBefore = await bal(conn, treasuryATA);

    await program.methods
      .approveAndExecute(new BN(amtIn.toString()), new BN(0), true)
      .accounts({
        agent:           agent.publicKey,
        approver:        approver.publicKey,
        pool:            poolPda,
        poolAuthority:   poolAuthPda,
        tokenAVault:     vaultAKp.publicKey,
        tokenBVault:     vaultBKp.publicKey,
        agentTokenIn:    agentATA,
        agentTokenOut:   agentBTA,
        treasury:        treasuryPda,
        treasuryTokenIn: treasuryATA,
        tokenProgram:    TOKEN_PROGRAM_ID,
      })
      .signers([agent, approver])
      .rpc();

    const agentAAfter   = await bal(conn, agentATA);
    const agentBAfter   = await bal(conn, agentBTA);
    const treasuryAfter = await bal(conn, treasuryATA);

    expect((agentABefore - agentAAfter).toString()).to.equal(amtIn.toString(),
      "agent paid full amtIn");
    expect((agentBAfter - agentBBefore).toString()).to.equal(out.toString(),
      "agent received correct amount_out");
    expect((treasuryAfter - treasuryBefore).toString()).to.equal(proto.toString(),
      "treasury received 0.02% protocol fee");
  });

  it("approve_and_execute: reverts when approver signature is missing", async () => {
    let threw = false;
    try {
      await program.methods
        .approveAndExecute(new BN(50_000), new BN(0), true)
        .accounts({
          agent:           agent.publicKey,
          approver:        approver.publicKey, // key present, but no sig
          pool:            poolPda,
          poolAuthority:   poolAuthPda,
          tokenAVault:     vaultAKp.publicKey,
          tokenBVault:     vaultBKp.publicKey,
          agentTokenIn:    agentATA,
          agentTokenOut:   agentBTA,
          treasury:        treasuryPda,
          treasuryTokenIn: treasuryATA,
          tokenProgram:    TOKEN_PROGRAM_ID,
        })
        .signers([agent]) // approver intentionally omitted
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  // ─── 9. Remove liquidity ───────────────────────────────────────────────────
  it("remove_liquidity: burns all LP shares, returns proportional reserves", async () => {
    const pos   = await program.account.position.fetch(positionPda);
    const pool  = await program.account.pool.fetch(poolPda);
    const lpRem = BigInt(pos.lpShares.toString());
    const lpSup = BigInt(pool.lpSupply.toString());
    const vA    = await bal(conn, vaultAKp.publicKey);
    const vB    = await bal(conn, vaultBKp.publicKey);

    // Proportional amounts the agent should receive
    const expA = (lpRem * vA) / lpSup;
    const expB = (lpRem * vB) / lpSup;

    const agentABefore = await bal(conn, agentATA);
    const agentBBefore = await bal(conn, agentBTA);

    await program.methods
      .removeLiquidity(
        new BN(lpRem.toString()),
        new BN(0),
        new BN(0),
      )
      .accounts({
        agent:         agent.publicKey,
        pool:          poolPda,
        poolAuthority: poolAuthPda,
        position:      positionPda,
        tokenAVault:   vaultAKp.publicKey,
        tokenBVault:   vaultBKp.publicKey,
        agentTokenA:   agentATA,
        agentTokenB:   agentBTA,
        tokenProgram:  TOKEN_PROGRAM_ID,
      })
      .signers([agent])
      .rpc();

    const agentAAfter = await bal(conn, agentATA);
    const agentBAfter = await bal(conn, agentBTA);

    expect((agentAAfter - agentABefore).toString()).to.equal(expA.toString(),
      "agent received proportional token A");
    expect((agentBAfter - agentBBefore).toString()).to.equal(expB.toString(),
      "agent received proportional token B");

    // Position lp_shares must be 0
    const posAfter = await program.account.position.fetch(positionPda);
    expect(posAfter.lpShares.isZero()).to.be.true;
  });
});

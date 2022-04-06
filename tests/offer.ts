import * as anchor from '@project-serum/anchor';
import { Program, web3 } from '@project-serum/anchor';
import { Marketplace } from '../target/types/marketplace';
import * as splToken from '@solana/spl-token';
import { PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import assert from "assert";
import { nft_data, nft_json_url } from "./data";
import { createMint } from "./utils/utils";

let provider = anchor.Provider.env()
anchor.setProvider(provider);

const program = anchor.workspace.Marketplace as Program<Marketplace>;


describe('marketplace with mint', () => {
    let admin: web3.Keypair;
    let adminTokenAccount: splToken.AccountInfo;
    let buyer: web3.Keypair;
    let buyerTokenAccount: splToken.AccountInfo;
    let buyerNftTokenAccount: web3.PublicKey;
    let creator: web3.Keypair;
    let creatorTokenAccount: splToken.AccountInfo;
    let seller: web3.Keypair;
    let sellerTokenAccount: splToken.AccountInfo;
    let sellerNftAssociatedTokenAccount: web3.PublicKey;
    let marketplacePDA: web3.PublicKey;
    let marketplaceDump: number;
    let marketplaceMint: splToken.Token;
    let fee = 200;
    let collectionName = "AURY"
    let collectionPDA: web3.PublicKey;
    let collectionDump: number
    let collectionFee = 500
    let nftMint: splToken.Token;
    let metadataPDA: web3.PublicKey;
    let escrowPDA: web3.PublicKey;
    let escrowDump: number;
    let buyOfferPDA: web3.PublicKey;
    let buyOfferDump: number;

    it('Prepare tests variables', async () => {
        admin = anchor.web3.Keypair.generate()
        let fromAirdropSignature = await provider.connection.requestAirdrop(
            admin.publicKey,
            anchor.web3.LAMPORTS_PER_SOL,
        );
        await provider.connection.confirmTransaction(fromAirdropSignature);

        creator = anchor.web3.Keypair.generate()
        fromAirdropSignature = await provider.connection.requestAirdrop(
            creator.publicKey,
            anchor.web3.LAMPORTS_PER_SOL,
        );
        await provider.connection.confirmTransaction(fromAirdropSignature);

        seller = anchor.web3.Keypair.generate()
        fromAirdropSignature = await provider.connection.requestAirdrop(
            seller.publicKey,
            anchor.web3.LAMPORTS_PER_SOL,
        );
        await provider.connection.confirmTransaction(fromAirdropSignature);

        buyer = anchor.web3.Keypair.generate()
        fromAirdropSignature = await provider.connection.requestAirdrop(
            buyer.publicKey,
            anchor.web3.LAMPORTS_PER_SOL,
        );
        await provider.connection.confirmTransaction(fromAirdropSignature);


        [marketplacePDA, marketplaceDump] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("MARKETPLACE"), admin.publicKey.toBuffer()],
            program.programId,
        );

        marketplaceMint = await splToken.Token.createMint(
            provider.connection,
            admin,
            admin.publicKey,
            null,
            6,
            splToken.TOKEN_PROGRAM_ID,
        );

        adminTokenAccount = await marketplaceMint.getOrCreateAssociatedAccountInfo(
            admin.publicKey,
        );
        creatorTokenAccount = await marketplaceMint.getOrCreateAssociatedAccountInfo(
            creator.publicKey,
        );
        sellerTokenAccount = await marketplaceMint.getOrCreateAssociatedAccountInfo(
            seller.publicKey,
        );
        buyerTokenAccount = await marketplaceMint.getOrCreateAssociatedAccountInfo(
            buyer.publicKey,
        );

        await marketplaceMint.mintTo(buyerTokenAccount.address, admin, [], 1000);

        [collectionPDA, collectionDump] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("MARKETPLACE"), Buffer.from(collectionName), marketplacePDA.toBuffer()],
            program.programId,
        );

        [escrowPDA, escrowDump] = await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("MARKETPLACE"),
                marketplacePDA.toBuffer(),
                marketplaceMint.publicKey.toBuffer(),
                Buffer.from("ESCROW"),
            ],
            program.programId,
        );

        const data = nft_data(creator.publicKey);
        const json_url = nft_json_url;
        const lamports = await Token.getMinBalanceRentForExemptMint(
            provider.connection
        );
        const [mint, metadataAddr, tx] = await createMint(
            creator.publicKey,
            seller.publicKey,
            lamports,
            data,
            json_url
        );
        const signers = [mint, creator];
        await provider.send(tx, signers);

        metadataPDA = metadataAddr
        nftMint = new Token(provider.connection, mint.publicKey, TOKEN_PROGRAM_ID, admin)

        sellerNftAssociatedTokenAccount = await Token.getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            nftMint.publicKey,
            seller.publicKey
        );

        buyerNftTokenAccount = await Token.getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            nftMint.publicKey,
            buyer.publicKey
        );

        [buyOfferPDA, buyOfferDump] = await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("MARKETPLACE"),
                marketplacePDA.toBuffer(),
                buyer.publicKey.toBuffer(),
                mint.publicKey.toBuffer(),
                Buffer.from("1000"),
                Buffer.from("ESCROW"),
            ],
            program.programId,
        );

        await program.methods.createMarketplace(marketplaceMint.publicKey, fee, adminTokenAccount.address, admin.publicKey).accounts(
            {
                payer: admin.publicKey,
                marketplace: marketplacePDA,
                mint: marketplaceMint.publicKey,
                escrow: escrowPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            }).signers([admin]).rpc();

        await program.methods.createCollection(collectionName, creator.publicKey, collectionFee, false).accounts(
            {
                authority: admin.publicKey,
                marketplace: marketplacePDA,
                collection: collectionPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            }).signers([admin]).rpc()
    });

    it('remove nft offer', async () => {
        await program.methods.createBuyOffer(new anchor.BN(1000)).accounts(
            {
                payer: buyer.publicKey,
                nftMint: nftMint.publicKey,
                metadata: metadataPDA,
                marketplace: marketplacePDA,
                collection: collectionPDA,
                escrow: escrowPDA,
                buyerPayingAccount: buyerTokenAccount.address,
                buyerNftAccount: buyerNftTokenAccount,
                buyOffer: buyOfferPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            }).signers([buyer]).rpc()

        await program.methods.removeBuyOffer().accounts({
            buyer: buyer.publicKey,
            buyerPayingAccount: buyerTokenAccount.address,
            marketplace: marketplacePDA,
            escrow: escrowPDA,
            buyOffer: buyOfferPDA,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        }).signers([buyer]).rpc()

        let escrowAccount = await marketplaceMint.getAccountInfo(escrowPDA)
        assert.equal(escrowAccount.amount, 0);
        let updatedBuyerAccount = await marketplaceMint.getAccountInfo(buyerTokenAccount.address)
        assert.equal(updatedBuyerAccount.amount, 1000);

        let closedBuyOffer = await provider.connection.getAccountInfo(buyOfferPDA);
        assert.equal(closedBuyOffer, null);
    });

    it('create nft offer', async () => {
        await program.methods.createBuyOffer(new anchor.BN(1000)).accounts({
            payer: buyer.publicKey,
            nftMint: nftMint.publicKey,
            metadata: metadataPDA,
            marketplace: marketplacePDA,
            collection: collectionPDA,
            escrow: escrowPDA,
            buyerPayingAccount: buyerTokenAccount.address,
            buyerNftAccount: buyerNftTokenAccount,
            buyOffer: buyOfferPDA,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        }).signers([buyer]).rpc()

        let buyOffer = await program.account.buyOffer.fetch(buyOfferPDA)
        assert.equal(buyOffer.marketplace.toString(), marketplacePDA.toString());
        assert.equal(buyOffer.mint.toString(), nftMint.publicKey.toString());
        assert.equal(buyOffer.proposedPrice.toString(), "1000");
        assert.equal(buyOffer.authority.toString(), buyer.publicKey.toString());
        assert.equal(buyOffer.destination.toString(), buyerNftTokenAccount.toString());

        let escrowAccount = await marketplaceMint.getAccountInfo(escrowPDA)
        assert.equal(escrowAccount.amount, 1000);

        let updatedBuyerAccount = await marketplaceMint.getAccountInfo(buyerTokenAccount.address)
        assert.equal(updatedBuyerAccount.amount, 0);
    });

    it('execute nft offer', async () => {
        await program.methods.executeOffer().accounts({
            seller: seller.publicKey,
            buyer: buyer.publicKey,
            marketplace: marketplacePDA,
            collection: collectionPDA,
            marketplaceDestAccount: adminTokenAccount.address,
            escrow: escrowPDA,
            sellerFundsDestAccount: sellerTokenAccount.address,
            destination: buyerNftTokenAccount,
            sellerNftAccount: sellerNftAssociatedTokenAccount,
            buyOffer: buyOfferPDA,
            metadata: metadataPDA,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        }).remainingAccounts([{ pubkey: creatorTokenAccount.address, isWritable: true, isSigner: false }])
            .signers([seller]).rpc()

        let escrowAccount = await marketplaceMint.getAccountInfo(escrowPDA)
        assert.equal(escrowAccount.amount, 0);

        let updatedBuyerAccount = await marketplaceMint.getAccountInfo(buyerTokenAccount.address)
        assert.equal(updatedBuyerAccount.amount, 0);

        let updatedBuyerNftAccount = await nftMint.getAccountInfo(buyerNftTokenAccount)
        assert.equal(updatedBuyerNftAccount.amount, 1);

        let updatedSellerAccount = await marketplaceMint.getAccountInfo(sellerTokenAccount.address)
        assert.equal(updatedSellerAccount.amount, 850);

        let updatedSellerNftAccount = await nftMint.getAccountInfo(sellerNftAssociatedTokenAccount)
        assert.equal(updatedSellerNftAccount.amount.toNumber(), 4);

        let updatedMarketplaceDestinationAccount = await marketplaceMint.getAccountInfo(adminTokenAccount.address)
        assert.equal(updatedMarketplaceDestinationAccount.amount.toNumber(), 50);

        let updatedCreator = await marketplaceMint.getAccountInfo(creatorTokenAccount.address)
        assert.equal(updatedCreator.amount.toNumber(), 100);

        let closedBuyOffer = await provider.connection.getAccountInfo(buyOfferPDA);
        assert.equal(closedBuyOffer, null);
    });
})
    ;

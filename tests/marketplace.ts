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
    let creator: web3.Keypair;
    let creatorTokenAccount: splToken.AccountInfo;
    let seller: web3.Keypair;
    let sellerTokenAccount: splToken.AccountInfo;
    let marketplacePDA: PublicKey;
    let marketplaceMint: splToken.Token;
    let fee = 200;
    let collectionName = "AURY"
    let collectionPDA: PublicKey;
    let collectionFee = 500;
    let nftMint: splToken.Token;
    let metadataPDA: PublicKey;
    let sellerNftAssociatedTokenAccount: PublicKey;
    let programNftVaultPDA: PublicKey;
    let sellOrderPDA: PublicKey;
    let escrowPDA: PublicKey;

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

        [marketplacePDA] = await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("MARKETPLACE"),
                admin.publicKey.toBuffer()
            ],
            program.programId,
        )

        marketplaceMint = await splToken.Token.createMint(
            provider.connection,
            admin,
            admin.publicKey,
            null,
            6,
            splToken.TOKEN_PROGRAM_ID,
        );

        [escrowPDA] = await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("MARKETPLACE"),
                marketplacePDA.toBuffer(),
                marketplaceMint.publicKey.toBuffer(),
                Buffer.from("ESCROW"),
            ],
            program.programId,
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

        [collectionPDA] = await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("MARKETPLACE"),
                Buffer.from(collectionName),
                marketplacePDA.toBuffer(),
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

        [programNftVaultPDA] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from('MARKETPLACE'), Buffer.from("vault"), nftMint.publicKey.toBuffer()],
            program.programId,
        );
        [sellOrderPDA] = await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("MARKETPLACE"),
                sellerNftAssociatedTokenAccount.toBuffer(),
                Buffer.from("1000") //Sell order price
            ],
            program.programId,
        );
    });

    it('create marketplace', async () => {
        await program.methods.createMarketplace(marketplaceMint.publicKey, fee, adminTokenAccount.address, admin.publicKey)
            .accounts({
                payer: admin.publicKey,
                marketplace: marketplacePDA,
                mint: marketplaceMint.publicKey,
                escrow: escrowPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            }).signers([admin]).rpc();
        let createdMarketplace = await program.account.marketplace.fetch(marketplacePDA)
        assert.equal(createdMarketplace.fees.toString(), fee.toString());
        assert.equal(createdMarketplace.mint.toString(), marketplaceMint.publicKey.toString());
        assert.equal(createdMarketplace.authority.toString(), admin.publicKey.toString());
        assert.equal(createdMarketplace.feesDestination.toString(), adminTokenAccount.address.toString());
    });

    it('fail: create marketplace fee > 10000', async () => {
        let tmpAuthority = anchor.web3.Keypair.generate()
        let fromAirdropSignature = await provider.connection.requestAirdrop(
            tmpAuthority.publicKey,
            anchor.web3.LAMPORTS_PER_SOL,
        )
        await provider.connection.confirmTransaction(fromAirdropSignature);
        let tmpTokenAccount = await marketplaceMint.getOrCreateAssociatedAccountInfo(
            tmpAuthority.publicKey,
        );

        let [failedMarketplacePDA, failedMarketplaceDump] = await anchor.web3.PublicKey.findProgramAddress(
            [Buffer.from("MARKETPLACE"), tmpAuthority.publicKey.toBuffer()],
            program.programId,
        )
        let feeAbove100 = 10001;
        let [escrowPDA] = await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("MARKETPLACE"),
                failedMarketplacePDA.toBuffer(),
                marketplaceMint.publicKey.toBuffer(),
                Buffer.from("ESCROW"),
            ],
            program.programId,
        );
        await assert.rejects(
            program.methods.createMarketplace(marketplaceMint.publicKey, feeAbove100, tmpTokenAccount.address, tmpAuthority.publicKey).accounts(
                {
                    payer: tmpAuthority.publicKey,
                    marketplace: failedMarketplacePDA,
                    mint: marketplaceMint.publicKey,
                    escrow: escrowPDA,
                    systemProgram: anchor.web3.SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                }).signers([tmpAuthority]).rpc(),
        )
    });

    it('update marketplace fields', async () => {
        let tmpFee = 5;
        let tmpAuthority = anchor.web3.Keypair.generate()
        let fromAirdropSignature = await provider.connection.requestAirdrop(
            admin.publicKey,
            anchor.web3.LAMPORTS_PER_SOL,
        )
        await provider.connection.confirmTransaction(fromAirdropSignature);
        let tmpTokenAccount = await marketplaceMint.getOrCreateAssociatedAccountInfo(
            tmpAuthority.publicKey,
        );

        await program.methods.updateMarketplace(tmpFee, tmpTokenAccount.address, tmpAuthority.publicKey).accounts(
            {
                authority: admin.publicKey,
                marketplace: marketplacePDA,
            }).signers([admin]).rpc()

        let updatedMarketplace = await program.account.marketplace.fetch(marketplacePDA)
        assert.equal(updatedMarketplace.fees.toString(), tmpFee.toString());
        assert.equal(updatedMarketplace.authority.toString(), tmpAuthority.publicKey.toString());
        assert.equal(updatedMarketplace.feesDestination.toString(), tmpTokenAccount.address.toString());

        //revert
        await program.methods.updateMarketplace(fee, adminTokenAccount.address, admin.publicKey).accounts(
            {
                authority: tmpAuthority.publicKey,
                marketplace: marketplacePDA,
            }).signers([tmpAuthority]).rpc();
    });

    it('update marketplace mint', async () => {
        let newMarketplaceMint = await splToken.Token.createMint(
            provider.connection,
            admin,
            admin.publicKey,
            null,
            6,
            splToken.TOKEN_PROGRAM_ID,
        );

        let [newEscrowPDA, newEscrowDump] = await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("MARKETPLACE"),
                marketplacePDA.toBuffer(),
                newMarketplaceMint.publicKey.toBuffer(),
                Buffer.from("ESCROW"),
            ],
            program.programId,
        );

        let newAdminTokenAccount = await newMarketplaceMint.getOrCreateAssociatedAccountInfo(
            admin.publicKey,
        );

        await program.methods.updateMarketplaceMint(newMarketplaceMint.publicKey, newAdminTokenAccount.address).accounts(
            {
                authority: admin.publicKey,
                marketplace: marketplacePDA,
                mint: newMarketplaceMint.publicKey,
                escrow: newEscrowPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            }).signers([admin]).rpc()
        let updatedMarketplace = await program.account.marketplace.fetch(marketplacePDA)
        assert.equal(updatedMarketplace.feesDestination.toString(), newAdminTokenAccount.address.toString());
        assert.equal(updatedMarketplace.mint.toString(), newMarketplaceMint.publicKey.toString());

        //revert
        await program.methods.updateMarketplaceMint(marketplaceMint.publicKey, adminTokenAccount.address).accounts({
            authority: admin.publicKey,
            marketplace: marketplacePDA,
            mint: marketplaceMint.publicKey,
            escrow: escrowPDA,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        }).signers([admin]).rpc()
    });

    it('create collection', async () => {
        await program.methods.createCollection(collectionName, creator.publicKey, collectionFee, false).accounts(
            {
                authority: admin.publicKey,
                marketplace: marketplacePDA,
                collection: collectionPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            }).signers([admin]).rpc()

        let createdCollection = await program.account.collection.fetch(collectionPDA)
        assert.equal(createdCollection.marketplaceKey.toString(), marketplacePDA.toString());
        assert.equal(createdCollection.requiredVerifier.toString(), creator.publicKey.toString());
        assert.equal(createdCollection.symbol.toString(), collectionName);
        assert.equal(createdCollection.fees.toString(), collectionFee.toString());
    });

    it('fail: create collection fee > 10000', async () => {
        let feeAbove100 = 10001
        let [failcollectionPDA] = await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("MARKETPLACE"),
                Buffer.from(collectionName + "fail"),
                marketplacePDA.toBuffer(),
            ],
            program.programId,
        );
        await assert.rejects(
            program.methods.createCollection(collectionName + "fail", creator.publicKey, feeAbove100, false).accounts({
                authority: admin.publicKey,
                marketplace: marketplacePDA,
                collection: failcollectionPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            }).signers([admin]).rpc()
        );
    });

    it('update collection', async () => {
        let tmpFee = 12
        let tmpName = "some name"
        let tmpRequiredVerifier = anchor.web3.Keypair.generate().publicKey

        await program.methods.updateCollection(tmpFee, tmpName, tmpRequiredVerifier, false).accounts({
            authority: admin.publicKey,
            marketplace: marketplacePDA,
            collection: collectionPDA,
        }).signers([admin]).rpc()

        let updatedCollection = await program.account.collection.fetch(collectionPDA)
        assert.equal(updatedCollection.requiredVerifier.toString(), tmpRequiredVerifier.toString());
        assert.equal(updatedCollection.symbol.toString(), tmpName);
        assert.equal(updatedCollection.fees.toString(), tmpFee.toString());
        assert.equal(updatedCollection.ignoreCreatorFee, false);

        // reset
        await program.methods.updateCollection(collectionFee, collectionName, creator.publicKey, false).accounts({
            authority: admin.publicKey,
            marketplace: marketplacePDA,
            collection: collectionPDA,
        },
        ).signers([admin]).rpc()
    });

    it('create sell order', async () => {
        let price = new anchor.BN(1000);
        let quantity = new anchor.BN(4);

        await program.methods.createSellOrder(price, quantity, sellerTokenAccount.address).accounts(
            {
                payer: seller.publicKey,
                sellerNftTokenAccount: sellerNftAssociatedTokenAccount,
                marketplace: marketplacePDA,
                collection: collectionPDA,
                mint: nftMint.publicKey,
                metadata: metadataPDA,
                vault: programNftVaultPDA,
                sellOrder: sellOrderPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            }
        ).signers([seller]).rpc()

        let sellOrder = await program.account.sellOrder.fetch(sellOrderPDA)
        assert.equal(sellOrder.price.toString(), price.toString());
        assert.equal(sellOrder.quantity.toString(), quantity.toString());
        assert.equal(sellOrder.mint.toString(), nftMint.publicKey.toString());
        assert.equal(sellOrder.authority.toString(), seller.publicKey.toString());
        assert.equal(sellOrder.destination.toString(), sellerTokenAccount.address.toString());
        let accountAfterSellOrderCreate = await nftMint.getAccountInfo(sellerNftAssociatedTokenAccount)
        assert.equal(accountAfterSellOrderCreate.amount, 1);
    });

    it('remove one item from sell order', async () => {
        let quantity = new anchor.BN(1);

        await program.methods.removeSellOrder(quantity).accounts({
            authority: seller.publicKey,
            sellerNftTokenAccount: sellerNftAssociatedTokenAccount,
            vault: programNftVaultPDA,
            sellOrder: sellOrderPDA,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY
        }).signers([seller]).rpc()

        let sellOrder = await program.account.sellOrder.fetch(sellOrderPDA)
        assert.equal(sellOrder.quantity.toNumber(), 3);
        let updatedAccount = await nftMint.getAccountInfo(sellerNftAssociatedTokenAccount)
        assert.equal(updatedAccount.amount, 2);
    });

    it('add one item to sell order', async () => {
        let quantity = new anchor.BN(1);

        await program.methods.addQuantityToSellOrder(quantity).accounts({
            authority: seller.publicKey,
            sellerNftTokenAccount: sellerNftAssociatedTokenAccount,
            vault: programNftVaultPDA,
            sellOrder: sellOrderPDA,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY
        }).signers([seller]).rpc()

        let sellOrder = await program.account.sellOrder.fetch(sellOrderPDA)
        assert.equal(sellOrder.quantity.toNumber(), 4);
        let updatedAccount = await nftMint.getAccountInfo(sellerNftAssociatedTokenAccount)
        assert.equal(updatedAccount.amount, 1);
    });

    it('buy the nft', async () => {
        let buyer = anchor.web3.Keypair.generate()
        let fromAirdropSignature = await provider.connection.requestAirdrop(
            admin.publicKey,
            anchor.web3.LAMPORTS_PER_SOL,
        )
        await provider.connection.confirmTransaction(fromAirdropSignature);
        let buyerNftAta = await nftMint.getOrCreateAssociatedAccountInfo(buyer.publicKey)
        let buyerMarketplaceAta = await marketplaceMint.getOrCreateAssociatedAccountInfo(buyer.publicKey)
        await marketplaceMint.mintTo(buyerMarketplaceAta.address, admin, [], 1000)

        let quantity_to_buy = new anchor.BN(1)
        await program.methods.buy(quantity_to_buy).accounts({
            buyer: buyer.publicKey,
            buyerNftTokenAccount: buyerNftAta.address,
            buyerPayingTokenAccount: buyerMarketplaceAta.address,
            marketplace: marketplacePDA,
            marketplaceDestAccount: adminTokenAccount.address,
            collection: collectionPDA,
            metadata: metadataPDA,
            vault: programNftVaultPDA,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
        }).remainingAccounts([
            { pubkey: creatorTokenAccount.address, isWritable: true, isSigner: false },
            { pubkey: sellOrderPDA, isWritable: true, isSigner: false },
            { pubkey: sellerTokenAccount.address, isWritable: true, isSigner: false },
        ]).signers([buyer]).rpc()

        let sellOrder = await program.account.sellOrder.fetch(sellOrderPDA)
        assert.equal(sellOrder.quantity.toNumber(), 3);

        let updatedAdminTokenAccount = await marketplaceMint.getAccountInfo(adminTokenAccount.address)
        assert.equal(updatedAdminTokenAccount.amount.toNumber(), 50);

        let updatedSellerTokenAccount = await marketplaceMint.getAccountInfo(sellerTokenAccount.address)
        assert.equal(updatedSellerTokenAccount.amount.toNumber(), 850);

        let updatedCreatorTokenAccount = await marketplaceMint.getAccountInfo(creatorTokenAccount.address)
        assert.equal(updatedCreatorTokenAccount.amount.toNumber(), 100);

        let buyerNftAtaAfterSell = await nftMint.getOrCreateAssociatedAccountInfo(buyer.publicKey)
        assert.equal(buyerNftAtaAfterSell.amount.toNumber(), 1);

        let updatedBuyerTokenAccount = await marketplaceMint.getAccountInfo(buyerMarketplaceAta.address)
        assert.equal(updatedBuyerTokenAccount.amount.toNumber(), 0);
    });
});

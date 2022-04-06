import * as anchor from '@project-serum/anchor';
import { Program, web3 } from '@project-serum/anchor';
import { Marketplace as MarketplaceProgramType } from '../target/types/marketplace';
import * as splToken from '@solana/spl-token';
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import assert from "assert";
import { nft_data, nft_json_url } from "./data";
import { createMint } from "./utils/utils";
import { Marketplace } from '../js/marketplace';
import { Collection } from "../js/collection";
import { getCollectionPDA, getEscrowPDA, getNftVaultPDA, getSellOrderPDA } from "../js/getPDAs";

let provider = anchor.Provider.env()
anchor.setProvider(provider);

const program = anchor.workspace.Marketplace as Program<MarketplaceProgramType>;

describe('ignore creators tests', () => {
    let creator: web3.Keypair;
    let creatorTokenAccount: splToken.AccountInfo;
    let seller: web3.Keypair;
    let sellerTokenAccount: splToken.AccountInfo;
    let marketplaceMint: splToken.Token;
    let nftMint: splToken.Token;
    let metadataPDA: web3.PublicKey;
    let sellerNftAssociatedTokenAccount: web3.PublicKey;

    let marketplace: Marketplace;
    let collection: Collection;


    it('Prepare tests variables', async () => {
        creator = anchor.web3.Keypair.generate()
        let fromAirdropSignature = await provider.connection.requestAirdrop(
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

        marketplaceMint = await splToken.Token.createMint(
            provider.connection,
            seller,
            seller.publicKey,
            null,
            6,
            splToken.TOKEN_PROGRAM_ID,
        );

        creatorTokenAccount = await marketplaceMint.getOrCreateAssociatedAccountInfo(
            creator.publicKey,
        );
        sellerTokenAccount = await marketplaceMint.getOrCreateAssociatedAccountInfo(
            seller.publicKey,
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
        nftMint = new Token(provider.connection, mint.publicKey, TOKEN_PROGRAM_ID, seller)

        sellerNftAssociatedTokenAccount = (await nftMint.getOrCreateAssociatedAccountInfo(seller.publicKey)).address

        marketplace = new Marketplace(provider)
        await marketplace.createMarketplace(seller, marketplaceMint.publicKey, 5, sellerTokenAccount.address)
        await marketplace.createCollection(seller, "AURY", creator.publicKey, "AURY", true)

        let collectionPDA = await getCollectionPDA(marketplace.marketplacePDA, "AURY")
        collection = new Collection(provider, marketplace.marketplacePDA, collectionPDA)
    });

    it('sell order ignore creators', async function () {
        await collection.sellAsset(
            nftMint.publicKey,
            sellerNftAssociatedTokenAccount,
            sellerTokenAccount.address,
            new anchor.BN(2000),
            new anchor.BN(2),
            seller
        )

        let buyer = anchor.web3.Keypair.generate()
        let fromAirdropSignature = await provider.connection.requestAirdrop(
            buyer.publicKey,
            anchor.web3.LAMPORTS_PER_SOL,
        );
        await provider.connection.confirmTransaction(fromAirdropSignature);

        let buyerTokenATA = await marketplaceMint.createAssociatedTokenAccount(buyer.publicKey)
        await marketplaceMint.mintTo(buyerTokenATA, seller, [], 4000)

        let buyerNftATA = await nftMint.createAssociatedTokenAccount(buyer.publicKey)

        await collection.buy(
            nftMint.publicKey,
            [
                await getSellOrderPDA(sellerNftAssociatedTokenAccount, new anchor.BN(2000)),
            ],
            buyerNftATA,
            buyerTokenATA,
            new anchor.BN(2),
            buyer,
        )

        let buyerNftAccountAfterSell = await nftMint.getAccountInfo(buyerNftATA)
        assert.equal(buyerNftAccountAfterSell.amount.toNumber(), 2)

        let buyerTokenAccountAfterSell = await marketplaceMint.getAccountInfo(buyerTokenATA)
        assert.equal(buyerTokenAccountAfterSell.amount.toNumber(), 0)

        let creatorTokenAccountAfterSell = await marketplaceMint.getAccountInfo(creatorTokenAccount.address)
        assert.equal(creatorTokenAccountAfterSell.amount.toNumber(), 0)
    });
});

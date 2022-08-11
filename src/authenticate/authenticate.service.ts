import { Injectable, Logger } from '@nestjs/common';
import { PublicKey, Connection } from "@solana/web3.js";
import { getAllTokenOwnerRecords, getRealm } from "@solana/spl-governance";
import { StreamChat } from 'stream-chat';
import { sign } from 'tweetnacl';
import bs58 = require('bs58');
import util = require('tweetnacl-util');
import { AuthBody } from 'src/types';
import "dotenv/config";

const RPC_CONNECTION = "https://ssc-dao.genesysgo.net/";
let connection = new Connection(process.env.MAINNET_RPC, "confirmed");

const serverClient = StreamChat.getInstance(process.env.STREAM_KEY, process.env.STREAM_SECRET);
serverClient.updateAppSettings({ multi_tenant_enabled: true });

@Injectable()
export class AuthenticateService {

    async authenticate(body: AuthBody): Promise<any>{
        if(!this.validateInput(body)) return {
            'error': 'Improperly formatted request.'
        }
        
        // Verify message signature
        const messageBuffer = util.decodeBase64(body.message);
        const verifiedMessage = sign.open(messageBuffer, bs58.decode(body.pubKey));
        if (verifiedMessage === null) {
            console.log('Signed message could not be verifed: ', JSON.stringify(body));
            return {
                error: 'Signed message could not be verified'
            };
        }
        
        let realmData;
        try {
            realmData = await getRealm(connection, new PublicKey(body.realm.pubKey));
        } catch (err){
            Logger.log(err);
        }
        const councilMint = realmData.account?.config?.councilMint.toBase58();
        console.log(councilMint);
        // Verify pubkey is a member or delegate in the realm
        const members = await getAllTokenOwnerRecords(
            connection,
            new PublicKey(body.realm.governanceId),
            new PublicKey(body.realm.pubKey)
        );
        
        for(const member of members) {
            if(member.account.governingTokenOwner.toBase58() === body.pubKey ||
               member.account.governanceDelegate?.toBase58() === body.pubKey ) {
                let hasCouncilToken = false;
                if(member.account.governingTokenMint.toString() === councilMint &&
                   !member.account.governingTokenDepositAmount.isZero()){
                    hasCouncilToken = true;
                    console.log(member.account.governingTokenDepositAmount.toString());
                }
                await this.addMemberToTeam(body.pubKey, body.realm.pubKey);
                await this.addMemberToChannels(body.pubKey, body.realm.pubKey, hasCouncilToken);
                return JSON.stringify({
                    chatAuthenticated: true,
                    streamToken: serverClient.createToken(body.pubKey.toString())
                });
               }
            }

        return {
            chatAuthenticated: false
        };
    }

    validateInput(body: AuthBody): boolean{
        const pubKeyRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
        return (
            /^[A-Za-z0-9+/=]{4,200}/.test(body.message)  &&
            pubKeyRegex.test(body.pubKey) &&
            pubKeyRegex.test(body.realm.governanceId) &&
            pubKeyRegex.test(body.realm.pubKey)
        );
    }

    async addMemberToTeam(pubKey: string, realmPubKey: string) {
        try {
            await serverClient.upsertUser({id: pubKey.toString(), teams: [realmPubKey.toString()]})
        } catch (err){
            Logger.error(err);
        }
    }

    async addMemberToChannels(pubKey: string, realmPubKey: string, hasCouncilToken: boolean){
        const channels = await serverClient.queryChannels({team: realmPubKey.toString()});
        let defaultChannels = {
            Community: { initialized: false },
            Council: { initialized: false }
        };
        channels.forEach( channel => {
            if(channel.data.name === 'Community'){
                channel.addMembers([pubKey]);
                defaultChannels.Community.initialized = true;
            }
            if(channel.data.name === 'Council' && hasCouncilToken){
                channel.addMembers([pubKey]);
                defaultChannels.Council.initialized = true;
            }
        });
        
        if(!defaultChannels.Community.initialized) {
            Logger.log('Creating Community channel for ' + realmPubKey + '.');
            try {
            await serverClient.channel('team', realmPubKey+'community', { 
                name: 'Community', team: realmPubKey.toString(),
                members: [pubKey, realmPubKey],
                created_by_id: realmPubKey
            }).create();
            } catch (err) {
                Logger.error(err);
            }
        }
        
        if(!defaultChannels.Council.initialized && hasCouncilToken) {
            Logger.log('Creating Council channel for ' + realmPubKey + '.');
            try {
                await serverClient.channel('team', realmPubKey+'council', { 
                    name: 'Council', team: realmPubKey.toString(),
                    members: [pubKey, realmPubKey],
                    created_by_id: realmPubKey
                }).create();
            } catch(err) {
                Logger.error(err)
            }
        }
    }
}

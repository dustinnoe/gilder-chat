
export interface AuthBody {
    pubKey: string,
    message: string,
    realm: {
        governanceId: string,
        pubKey: string
    }
};

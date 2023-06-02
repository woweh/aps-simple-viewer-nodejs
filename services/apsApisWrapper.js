const fs = require('fs');
const APS = require('forge-apis');
const {APS_CLIENT_ID, APS_CLIENT_SECRET, APS_BUCKET} = require('../config.js');

const internalScope = ['bucket:read', 'bucket:create', 'data:read', 'data:write', 'data:create'];
let internalAuthClient = new APS.AuthClientTwoLegged(APS_CLIENT_ID, APS_CLIENT_SECRET, internalScope, true);

const publicScope = ['viewables:read']
let publicAuthClient = new APS.AuthClientTwoLegged(APS_CLIENT_ID, APS_CLIENT_SECRET, publicScope, true);

const service = module.exports = {};


/**
 * Get a 2-legged access token for service internal communication.
 * @returns {Promise<APS.AuthClientTwoLegged.Credentials>}
 */
service.getInternalToken = async () => {
    if (!internalAuthClient.isAuthorized()) {
        await internalAuthClient.authenticate();
    }
    return internalAuthClient.getCredentials();
};


/**
 * Get a 2-legged access token for public communication.
 * @returns {Promise<APS.AuthClientTwoLegged.Credentials>}
 */
service.getPublicToken = async () => {
    if (!publicAuthClient.isAuthorized()) {
        await publicAuthClient.authenticate();
    }
    return publicAuthClient.getCredentials();
};


/**
 * Check if a bucket exists.
 * @param {string} bucketKey
 * @returns
 */
service.bucketExists = async (bucketKey) => {
    console.log("")
    console.log(`Checking if bucket ${bucketKey} exists`);
    try {
        await new APS.BucketsApi().getBucketDetails(bucketKey, null, await service.getInternalToken());
        return true;
    } catch (err) {
        if (err.response.status === 404) {
            return false;
        } else {
            throw err;
        }
    }
}


/**
 * Ensure a bucket exists, creating it if necessary.
 * @param {string} bucketKey
 */
service.ensureBucketExists = async (bucketKey) => {
    console.log("")
    console.log(`Ensuring bucket ${bucketKey} exists`);
    try {
        await new APS.BucketsApi().getBucketDetails(bucketKey, null, await service.getInternalToken());
    } catch (err) {
        if (err.response.status === 404) {
            await new APS.BucketsApi().createBucket({
                bucketKey,
                policyKey: 'temporary'
            }, {}, null, await service.getInternalToken());
        } else {
            throw err;
        }
    }
};


/**
 * List all objects in the APS_BUCKET.
 * @returns {Promise<APS.BucketsApi.Buckets>}
 */
service.listObjects = async () => {
    console.log("")
    console.log(`Listing objects in bucket ${APS_BUCKET}`);

    await service.ensureBucketExists(APS_BUCKET);

    console.log("initial getting objects");
    let resp = await new APS.ObjectsApi().getObjects(APS_BUCKET, {limit: 64}, null, await service.getInternalToken());
    console.log("response:\n", resp);

    let objects = resp.body.items;
    while (resp.body.next) {

        const startAt = new URL(resp.body.next).searchParams.get('startAt');

        console.log("getting more objects, startAt: ", startAt || "null");
        resp = await new APS.ObjectsApi().getObjects(APS_BUCKET, {
            limit: 64,
            startAt
        }, null, await service.getInternalToken());
        console.log("response:\n", resp);

        objects = objects.concat(resp.body.items);
    }

    console.log(`Found ${objects.length} objects in bucket ${APS_BUCKET}`);
    return objects;
};


/**
 * Upload a file to the APS_BUCKET.
 * @param {string} objectName
 * @param {string} filePath
 * @returns
 */
service.uploadObject = async (objectName, filePath) => {
    console.log("")
    console.log(`Uploading ${filePath} to ${objectName}`);
    await service.ensureBucketExists(APS_BUCKET);
    const buffer = await fs.promises.readFile(filePath);
    const results = await new APS.ObjectsApi().uploadResources(
        APS_BUCKET,
        [{objectKey: objectName, data: buffer}],
        {useAcceleration: false, minutesExpiration: 15},
        null,
        await service.getInternalToken()
    );
    console.log("Upload results:\n", results);
    if (results[0].error) {
        throw results[0].completed;
    } else {
        return results[0].completed;
    }
};


/**
 * Start a translation job.
 * @param {string} urn 
 * @param {string} rootFilename 
 * @returns 
 */
service.translateObject = async (urn, rootFilename) => {
    console.log("")
    console.log(`Starting translation for ${urn}`);
    const job = {
        input: {urn},
        output: {formats: [{type: 'svf2', views: ['2d', '3d']}]}
    };
    if (rootFilename) {
        job.input.compressedUrn = true;
        job.input.rootFilename = rootFilename;
    }
    console.log("translation job:\n", job);
    const resp = await new APS.DerivativesApi().translate(job, {}, null, await service.getInternalToken());
    console.log("response:\n", resp);
    return resp.body;
};


/**
 * Get the manifest (> status and results) of a translation job.
 * @param {string} urn 
 * @returns 
 */
service.getManifest = async (urn) => {
    console.log("")
    console.log(`Getting manifest for ${urn}`);
    try {
        const resp = await new APS.DerivativesApi().getManifest(urn, {}, null, await service.getInternalToken());
        console.log("response:\n", resp);
        return resp.body;
    } catch (err) {
        if (err.response.status === 404) {
            return null;
        } else {
            throw err;
        }
    }
};


service.downloadDerivative = async (urn, derivativeUrn, filePath) => {
    console.log("")
    console.log(`Downloading ${derivativeUrn} from ${urn}`);
    // There is no API function to download a derivative
    // => https://aps.autodesk.com/en/docs/model-derivative/v2/reference/http/urn-manifest-derivativeUrn-signedcookies-GET/

    
    const resp = await new APS.DerivativesApi().getDerivativeManifest(urn, derivativeUrn, {}, null, await service.getInternalToken());
    console.log("response:\n", resp);
    const buffer = await new APS.DerivativesApi().getDerivativeManifest(urn, derivativeUrn, {}, null, await service.getInternalToken());
    await fs.promises.writeFile(filePath, buffer);
    return resp.body;
};


service.urnify = (id) => Buffer.from(id).toString('base64').replace(/=/g, '');

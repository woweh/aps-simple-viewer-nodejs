/**
 * Wrapper for APS APIs (Autodesk Platform Services, formerly Forge).
 */
const fs = require("fs");
const APS = require("forge-apis");
const {
    APS_CLIENT_ID,
    APS_CLIENT_SECRET,
    APS_BUCKET,
} = require("../config.js");

const internalScope = [
    "bucket:read",
    "bucket:create",
    "data:read",
    "data:write",
    "data:create",
];
let internalAuthClient = new APS.AuthClientTwoLegged(
    APS_CLIENT_ID,
    APS_CLIENT_SECRET,
    internalScope,
    true
);

const publicScope = ["viewables:read"];
let publicAuthClient = new APS.AuthClientTwoLegged(
    APS_CLIENT_ID,
    APS_CLIENT_SECRET,
    publicScope,
    true
);

const service = (module.exports = {});

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
 * @returns {Promise<boolean>} True if the bucket exists, false otherwise.
 */
service.bucketExists = async (bucketKey) => {
    console.log("");
    console.log(`Checking if bucket ${bucketKey} exists`);
    try {
        await new APS.BucketsApi().getBucketDetails(
            bucketKey,
            null,
            await service.getInternalToken()
        );
        return true;
    } catch (err) {
        if (err.response.status === 404) {
            return false;
        } else {
            throw err;
        }
    }
};

/**
 * Ensure a bucket exists, creating it if necessary.
 * @param {string} bucketKey The bucket key.
 */
service.ensureBucketExists = async (bucketKey) => {
    console.log("");
    console.log(`Ensuring bucket ${bucketKey} exists`);
    try {
        await new APS.BucketsApi().getBucketDetails(
            bucketKey,
            null,
            await service.getInternalToken()
        );
    } catch (err) {
        if (err.response.status === 404) {
            await new APS.BucketsApi().createBucket(
                {
                    bucketKey,
                    policyKey: "temporary",
                },
                {},
                null,
                await service.getInternalToken()
            );
        } else {
            throw err;
        }
    }
};

/**
 * List all objects in the APS_BUCKET.
 * @returns {Promise<APS.BucketsApi.Buckets>} List of objects.
 */
service.listObjects = async () => {
    console.log("");
    console.log(`Listing objects in bucket ${APS_BUCKET}`);

    await service.ensureBucketExists(APS_BUCKET);

    console.log("initial getting objects");
    let resp = await new APS.ObjectsApi().getObjects(
        APS_BUCKET,
        { limit: 64 },
        null,
        await service.getInternalToken()
    );
    console.log("response:\n", resp);

    let objects = resp.body.items;
    while (resp.body.next) {
        const startAt = new URL(resp.body.next).searchParams.get("startAt");

        console.log("getting more objects, startAt: ", startAt || "null");
        resp = await new APS.ObjectsApi().getObjects(
            APS_BUCKET,
            {
                limit: 64,
                startAt,
            },
            null,
            await service.getInternalToken()
        );
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
 * @returns {Promise<APS.ObjectsApi.ObjectFullDetails>} The uploaded object.
 */
service.uploadObject = async (objectName, filePath) => {
    console.log("");
    console.log(`Uploading ${filePath} to ${objectName}`);
    await service.ensureBucketExists(APS_BUCKET);
    const buffer = await fs.promises.readFile(filePath);
    const results = await new APS.ObjectsApi().uploadResources(
        APS_BUCKET,
        [{ objectKey: objectName, data: buffer }],
        { useAcceleration: false, minutesExpiration: 15 },
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
 * @param {string} urn The urn of the uploaded CAD file in the bucket (urnified objectID).
 * @param {string} rootFilename The root (= original) filename of the CAD file.
 * @returns {Promise<APS.DerivativesApi.Job>} The translation job.
 */
service.translateObject = async (urn, rootFilename) => {
    console.log("");
    console.log(`Starting translation for ${urn}`);
    const job = {
        input: { urn },
        output: { formats: [{ type: "svf2", views: ["2d", "3d"] }] },
    };
    if (rootFilename) {
        job.input.compressedUrn = true;
        job.input.rootFilename = rootFilename;
    }
    console.log("translation job:\n", job);
    const resp = await new APS.DerivativesApi().translate(
        job,
        {},
        null,
        await service.getInternalToken()
    );
    console.log("response:\n", resp);
    return resp.body;
};

/**
 * Get the manifest (> status and results) of a translation job.
 * @param {string} urn The urn of the viewable
 * @returns {Promise<APS.DerivativesApi.Manifest>} The manifest.
 */
service.getManifest = async (urn) => {
    console.log("");
    console.log(`Getting manifest for "${urn}"`);
    try {
        const resp = await new APS.DerivativesApi().getManifest(
            urn,
            {},
            null,
            await service.getInternalToken()
        );
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

/**
 * Gets the signed dowload urn and cookie value for dowloading a derivative.
 * @param {String} urn The urn of the viewable
 * @param {String} derivativeUrn The urn of the derivative (extracted from the manifest)
 * @returns {Promise<{data: APS.DerivativesApi.Derivative, cookieValue: string}>} The signed download urn and cookie value.
 */
service.getDerivativeDownloadUrn = async (urn, derivativeUrn) => {
    console.log();
    console.log(`Getting download urn for derivative "${derivativeUrn}" and urn "${urn}"`);

    const resp = await new APS.DerivativesApi().getDerivativeDownloadUrl(
        urn,
        derivativeUrn,
        {},
        null,
        await service.getInternalToken()
    );

    const data = resp.body;
    console.log("Response data: ", data);

    const cookieValue = resp.headers['set-cookie'].join(';');
    console.log("cookieValue: ", cookieValue);

    return { data, cookieValue };
};


/**
 * Base64 encodes the given "Object ID" string to create a "urn" that is used when creating the translation job.
 * @param {String} id The Autodesk "Object ID" of CAD file in the bucket.
 * @returns {String} The urnified object ID.
 */
service.urnify = (id) => Buffer.from(id).toString("base64").replace(/=/g, "");

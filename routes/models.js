const express = require('express');
const formidable = require('express-formidable');
const { listObjects, uploadObject, translateObject, getManifest, urnify } = require('../services/apsApisWrapper.js');
const path = require('path');
const fs = require('fs');

let router = express.Router();

const modelsEndpoint = `/api/models`;

/**
 * GET as list of all models in the bucket.
 */
router.get(modelsEndpoint, async function (req, res, next) {
    console.log("")
    console.log('GET models request: ', req);
    try {
        const objects = await listObjects();
        console.log(objects);
        res.json(objects.map(o => ({
            name: o.objectKey,
            urn: urnify(o.objectId)
        })));
    } catch (err) {
        console.log(err);
        next(err);
    }
});


/**
 * Get the status of the model translation for the given urn.
 */
router.get(`${modelsEndpoint}/:urn/status`, async function (req, res, next) {
    console.log("")
    console.log('GET models status for urn: ', req.params.urn);
    try {
        const manifest = await getManifest(req.params.urn);
        if (manifest) {
            let messages = [];
            if (manifest.derivatives) {
                for (const derivative of manifest.derivatives) {
                    messages = messages.concat(derivative.messages || []);
                    if (derivative.children) {
                        for (const child of derivative.children) {
                            messages.concat(child.messages || []);
                        }
                    }
                }
            }
            res.json({ status: manifest.status, progress: manifest.progress, messages });
        } else {
            res.json({ status: 'n/a' });
        }
    } catch (err) {
        console.log(err);
        next(err);
    }
});


/**
 * Download the properties for the given urn.
 */
router.get(`${modelsEndpoint}/:urn/properties`, async function (req, res, next) {
    console.log("")
    console.log('GET / download properties for urn: ', req.params.urn);

    try {
        const manifest = await getManifest(req.params.urn);

        let parsedManifest = parseManifest(manifest);
        if (parsedManifest instanceof Error) {
            next(parsedManifest);
            return;
        }

        const resultDir = createResultDirectory(parseManifest.cadFileName);
        if (resultDir instanceof Error) {
            next(resultDir);
            return;
        }

        const sqLitePath = path.join(resultDir, 'properties.sqlite');
        const propertiesPath = path.join(resultDir, 'properties.json');




    } catch (err) {
        console.log(err);
        next(err);
    }
});


function parseManifest(manifest) {
    try {
        let cadFileName = '';
        let sqLiteUrn = '';
        let propertiesUrn = '';

        if (!manifest) {
            return Error('no manifest received');
        }
        if (!manifest.derivatives) {
            return Error('manifest has no derivatives');
        }
        for (const derivative of manifest.derivatives) {
            if (!derivative.outputType?.includes('svf') ||
                derivative.progress != 'complete' ||
                !derivative.status != 'success' ||
                !derivative.children) {
                continue;
            }
            cadFileName = derivative.name;
            for (const child of derivative.children) {
                if (child.role == 'Autodesk.CloudPlatform.PropertyDatabase' &&
                    child.type == 'resource') {
                    sqLiteUrn = child.urn;
                }
                if (child.role == 'Autodesk.AEC.ModelData' &&
                    child.type == 'resource') {
                    propertiesUrn = child.urn;
                }
            }
        }
        return { cadFileName, sqLiteUrn, propertiesUrn };
    } catch (err) {
        return err;
    }
}


function createResultDirectory(cadFileName) {

    const baseResultDir = path.join(__dirname, '..', 'results');
    if (!createDirectory(baseResultDir)) {
        return Error('Could not create base results directory.');
    }

    const resultDir = path.join(resultDir, cadFileName);
    if (!createDirectory(resultDir)) {
        return Error('Could not create results directory.');
    }

    return resultDir;
}


function createDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
    }
    return fs.existsSync(dirPath);
}


/**
 * POST a new model to translate.
 * This uploads a file to the bucket and then starts the translation.
 */
router.post(modelsEndpoint, formidable(), async function (req, res, next) {
    console.log("")
    console.log('POST models request: ', req);
    const file = req.files['model-file'];
    if (!file) {
        res.status(400).send('The required field ("model-file") is missing.');
        return;
    }
    try {
        const obj = await uploadObject(file.name, file.path);
        console.log(obj);
        await translateObject(urnify(obj.objectId), req.fields['model-zip-entrypoint']);
        res.json({
            name: obj.objectKey,
            urn: urnify(obj.objectId)
        });
    } catch (err) {
        console.log(err);
        next(err);
    }
});

module.exports = router;

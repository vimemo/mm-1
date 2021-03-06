/*
Before Chrome 66, web requests from the service worker don't include credentials (cookies, basic auth, etc).
This means service workers cannot cache any resource behind an authenticated endpoint.
Therefore, we extract all cacheable resources into a folder and serve them as public static content.
*/

const
  fs = require('fs'),
  path = require('path'),
  db = require('./db'),
  environment = require('./environment'),
  logger = require('./logger'),
  APP_PREFIX_TOKEN = 'APP_PREFIX',
  STATIC_RESOURCE_DESTINATION = path.join(__dirname, `extracted-resources/`),
  isAttachmentCacheable = name => name === 'manifest.json' || !!name.match(/(?:audio|css|fonts|templates|img|js|xslt)\/.*/);

// Map of attachmentName -> attachmentDigest used to avoid extraction of unchanged documents
let extractedDigests = {};

const createFolderIfDne = x => !fs.existsSync(x) && fs.mkdirSync(x);

const extractCacheableAttachments = () => {
  createFolderIfDne(STATIC_RESOURCE_DESTINATION);
  return db.medic
    .get('_design/medic')
    .then(ddoc => Promise.resolve(Object.keys(ddoc._attachments))
      .then(attachmentNames => attachmentNames.filter(name => extractedDigests[name] !== ddoc._attachments[name].digest))
      .then(attachmentNames => attachmentNames.filter(isAttachmentCacheable))
      .then(requiredNames => Promise.all(requiredNames.map(required => extractAttachment(required))))
      .then(attachmentNames => attachmentNames.forEach(name => extractedDigests[name] = ddoc._attachments[name].digest))
    );
};

const extractAttachment = attachmentName => db.medic
  .getAttachment('_design/medic', attachmentName)
  .then(raw => new Promise((resolve, reject) => {
    const outputPath = path.join(STATIC_RESOURCE_DESTINATION, attachmentName);
    createFolderIfDne(path.dirname(outputPath));

    /*
    At build time, we can't know what the COUCH_URL will be when API starts.
    This means, some paths (eg. inbox.html) are unknown until the app starts.
    In this approach, I'm hydrating a token used in the build with environment values once they are known.
    */
    const hydrated = attachmentName === 'js/service-worker.js' ? raw.toString().replace(APP_PREFIX_TOKEN, `/${environment.db}/_design/${environment.ddoc}/_rewrite/`) : raw;
    fs.writeFile(outputPath, hydrated, err => {
      logger.debug(`Extracted attachment ${outputPath}`);
      if (err) {
        return reject(err);
      }
      resolve(attachmentName);
    });
  }));

module.exports = {
  run: extractCacheableAttachments,
  clearCache: () => extractedDigests = {},
};

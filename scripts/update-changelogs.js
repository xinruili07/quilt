const {
  readFileSync,
  writeJsonSync,
  removeSync,
  writeFileSync,
} = require('fs-extra');
const {join, resolve} = require('path');
const glob = require('glob');
const parseChangelog = require('changelog-parser');

const PACKAGES_PATH = resolve(__dirname, '../packages');
const TEMP_FILE_PATH = resolve(__dirname, './tmp-comparison.json');

var mode = process.argv.slice(2);

// Check argument
if (mode.length != 1) {
  console.warn('1 argument expected (--preversion or --version)');
  process.exit(1);
} else if (mode[0] == '--preversion') {
  before();
} else if (mode[0] == '--version') {
  after();
} else {
  console.error(`Unrecognized flag ${mode[0]}`);
  process.exit(1);
}

/**
 * Save current state of changelog and package.json
 */
async function before() {
  console.log('Running --preversion');

  // Read packages info
  const packagesInfo = await readAllPackages();

  // Write to temp file
  writeJsonSync(TEMP_FILE_PATH, packagesInfo);
}

/**
 * Compare current state with state saved in temp file
 */
async function after() {
  console.log('Running --version');

  // Parse temp file
  var prevPackagesInfo;
  try {
    prevPackagesInfo = JSON.parse(readFileSync(TEMP_FILE_PATH));
  } catch (err) {
    console.warn('Please run --preversion before running --version');
    process.exit(1);
  }

  // Read packages info
  const currPackagesInfo = await readAllPackages();

  var numChanges = 0,
    numModifiedChangelogs = 0;

  // Compare and write updates to changelog
  for (let i = 0; i < currPackagesInfo.length; i++) {
    var changes = comparePackage(currPackagesInfo[i], prevPackagesInfo[i]);

    // Update change count
    numChanges += changes.length;
    numModifiedChangelogs += changes.length == 0 ? 0 : 1;

    updateChangelog(
      currPackagesInfo[i].changelogPath,
      currPackagesInfo[i].changelog,
      currPackagesInfo[i].packageJson.version,
      changes,
    );
  }

  // Delete temp file
  removeSync(TEMP_FILE_PATH);

  console.log(
    `Applied ${numChanges} changes to ${numModifiedChangelogs} changelogs`,
  );
}

/**
 * Write changes to changelog file
 *
 * @param {string} path Path to changelog
 * @param {object} changelog Current version of changelog
 * @param {string} newVersion New package version number
 * @param {array} changes Changes found in package.json
 */
function updateChangelog(path, changelog, newVersion, changes) {
  // If nothing to update -> return
  if (changes.length == 0) return;

  const date = new Date();
  var body = '';
  var title = `[${newVersion}] - ${date.getFullYear()}-${
    date.getMonth() + 1
  }-${date.getDate()}`;

  changes.forEach(change => {
    if (change.before == null)
      body += `- Added \`${change.name}@${change.now}\` in the list of dependencies.\r\n`;
    else
      body += `- Updated \`${change.name}\` dependency to \`${change.now}\`.\r\n`;
  });

  // Trim trailing \r\n
  body = body.substring(0, body.length - 2);

  changelog.versions.splice(0, 0, {title, body});

  // Write to file
  writeChangelogToFile(path, changelog);
}

/**
 * Write JSON changelog to file
 *
 * @param {string} path Path to changelog file
 * @param {object} changelogJson Json version of changelog
 */
function writeChangelogToFile(path, changelogJson) {
  var changelog = '';

  changelog += '# ' + changelogJson.title + '\r\n\r\n';
  changelog += changelogJson.description;

  changelogJson.versions.forEach(version => {
    changelog += '\r\n\r\n## ' + version.title + '\r\n\r\n';
    changelog += version.body;
  });

  writeFileSync(path, changelog);
}

/**
 * Get dependencies difference
 *
 * @param {object} newPackage New package.json
 * @param {object} oldPackage Old package.json
 * @returns {array} Differences
 */
function comparePackage(newPackage, oldPackage) {
  const newDependencies = newPackage.packageJson.dependencies;
  const oldDependencies = oldPackage.packageJson.dependencies;
  var diff = [];

  for (const dep in newDependencies) {
    if (newDependencies.hasOwnProperty(dep)) {
      if (oldDependencies.hasOwnProperty(dep)) {
        // For different version
        if (oldDependencies[dep] != newDependencies[dep]) {
          diff.push({
            name: dep,
            before: oldDependencies[dep],
            now: newDependencies[dep],
          });
        }
      }
      // If new dep
      else {
        diff.push({
          name: dep,
          before: null,
          now: newDependencies[dep],
        });
      }
    }
  }

  return diff;
}

/**
 * Read package.json and CHANGELOG.md from all packages
 *
 * @returns {Promise} Resolves to array of parsed package info
 */
async function readAllPackages() {
  return Promise.all(
    glob
      .sync(join(PACKAGES_PATH, '*/'))
      .filter(hasPackageJSON)
      .map(parsePackageInfo),
  );
}

/**
 * Parse package.json and changelog file
 *
 * @param {string} packageDir Path to package directory
 * @returns {Promise} Promise
 */
async function parsePackageInfo(packageDir) {
  // Get paths
  const packageJsonPath = join(packageDir, 'package.json');
  const changelogPath = join(packageDir, 'CHANGELOG.md');

  // Parse package.json file
  const packageJson = JSON.parse(
    safeReadSync(packageJsonPath, {encoding: 'utf8'}).toString('utf-8'),
  );

  // Parse changelog file
  var changelog = {};
  try {
    changelog = await parseChangelog(changelogPath);
  } catch (err) {
    console.error(err);
  }

  return {
    packageJsonPath,
    changelogPath,
    changelog,
    packageJson,
  };
}

/**
 * Reads a file - Returns an empty string if err
 *
 * @param {string} path Path to file
 * @param {object} options Options for readFileSync
 * @returns {string}
 */
function safeReadSync(path, options) {
  try {
    return readFileSync(path, options);
  } catch (err) {
    return '';
  }
}

/**
 * Checks if folder has a non-empty package.json file
 *
 * @param {string} packageDir Path to package folder
 * @returns {boolean}
 */
function hasPackageJSON(packageDir) {
  const packageJson = safeReadSync(join(packageDir, 'package.json'), {
    encoding: 'utf8',
  });

  return packageJson.length > 0;
}

const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

// Changing the logo also changes its Shell resource path, avoiding stale icon caches.
const iconName = `icon-${crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'build/icon.svg'))).digest('hex').slice(0, 12)}.ico`

const thumbprint = process.env.QTYPORA_SIGNING_THUMBPRINT
const output = process.env.QTYPORA_RELEASE_DIR
if (process.platform !== 'win32' || !/^[A-F0-9]{40}$/i.test(thumbprint ?? '')) {
  throw new Error('Use npm run package:win:internal to prepare the local signing certificate.')
}
const runRoot = path.join(__dirname, '.debug', 'package-runs') + path.sep
if (!output || !path.isAbsolute(output) || !path.resolve(output).startsWith(runRoot)) {
  throw new Error('Use the packaging script to create an isolated output directory.')
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.qtypora.internal',
  productName: 'QTypora Internal',
  directories: { output, buildResources: 'build' },
  files: ['out/**/*', 'package.json'],
  extraResources: [
    { from: 'build/icon-512.png', to: 'branding/icon.png' },
    { from: 'build/icon.svg', to: 'branding/icon.svg' },
    { from: 'build/icon.ico', to: `branding/${iconName}` },
  ],
  asar: true,
  npmRebuild: false,
  forceCodeSigning: true,
  publish: null,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    executableName: 'QTypora',
    icon: 'build/icon.ico',
    signtoolOptions: {
      certificateSha1: thumbprint,
      publisherName: 'QTypora Internal Test',
      signingHashAlgorithms: ['sha256'],
      sign: path.join(__dirname, 'scripts/sign-windows.cjs'),
    },
  },
  nsis: {
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    artifactName: 'QTypora-${version}-internal-${arch}-setup.${ext}',
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    packElevateHelper: false,
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'QTypora Internal',
    installerLanguages: ['zh_CN', 'en_US'],
    language: '2052',
    differentialPackage: false,
    include: 'build/installer.nsh',
  },
}

const { withInfoPlist, withMainApplication } = require('expo/config-plugins');

const WEBRTC_OPTIONS_IMPORT = 'com.oney.WebRTCModule.WebRTCModuleOptions';

function applyWebRTCScreenCapture(contents, language) {
  if (language !== 'java' && language !== 'kt') {
    throw new Error(`Unsupported MainApplication language: ${language}`);
  }

  const isJava = language === 'java';
  const lineEnding = contents.includes('\r\n') ? '\r\n' : '\n';
  const importStatement = `import ${WEBRTC_OPTIONS_IMPORT}${isJava ? ';' : ''}`;
  const initialization = `WebRTCModuleOptions.getInstance().enableMediaProjectionService = true${
    isJava ? ';' : ''
  }`;

  const packageDeclaration = /^(package\s+[^\r\n;]+;?\r?\n)/m;
  if (!packageDeclaration.test(contents)) {
    throw new Error('Unable to locate the MainApplication package declaration.');
  }

  const withImport = contents.includes(importStatement)
    ? contents
    : contents.replace(packageDeclaration, `$1${lineEnding}${importStatement}${lineEnding}`);

  if (withImport.includes(initialization)) {
    return withImport;
  }

  const onCreateAnchor = /^([ \t]*)super\.onCreate\(\);?[ \t]*$/m;
  if (!onCreateAnchor.test(withImport)) {
    throw new Error('Unable to locate super.onCreate() in MainApplication.');
  }

  return withImport.replace(
    onCreateAnchor,
    (anchor, indentation) => `${anchor}${lineEnding}${indentation}${initialization}`
  );
}

function removeUnusedCameraUsageDescription(infoPlist) {
  const sanitizedInfoPlist = { ...infoPlist };
  delete sanitizedInfoPlist.NSCameraUsageDescription;
  return sanitizedInfoPlist;
}

const withWebRTCScreenCapture = (config) => {
  const withAndroidScreenCapture = withMainApplication(config, (mainApplication) => {
    mainApplication.modResults.contents = applyWebRTCScreenCapture(
      mainApplication.modResults.contents,
      mainApplication.modResults.language
    );
    return mainApplication;
  });

  return withInfoPlist(withAndroidScreenCapture, (infoPlist) => {
    infoPlist.modResults = removeUnusedCameraUsageDescription(infoPlist.modResults);
    return infoPlist;
  });
};

module.exports = withWebRTCScreenCapture;
module.exports.applyWebRTCScreenCapture = applyWebRTCScreenCapture;
module.exports.removeUnusedCameraUsageDescription = removeUnusedCameraUsageDescription;

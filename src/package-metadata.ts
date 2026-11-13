import { readOrganizationIdentity, readPackageJsonUrl, toTrimmedString } from "@trebired/utils";

const packageJson = readPackageJsonUrl(new URL("../package.json", import.meta.url));
const organization = readOrganizationIdentity({ packageJson });

const PACKAGE_ORGANIZATION_NAME = organization.name;
const PACKAGE_NAME = toTrimmedString(packageJson?.name) || `@${PACKAGE_ORGANIZATION_NAME}/sockets`;
const PACKAGE_VERSION = toTrimmedString(packageJson?.version, "0.1.0");

export { PACKAGE_NAME, PACKAGE_ORGANIZATION_NAME, PACKAGE_VERSION };

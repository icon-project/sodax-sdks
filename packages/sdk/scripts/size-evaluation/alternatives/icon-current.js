import * as IconSdkRaw from 'icon-sdk-js';
const IconSdk = 'default' in IconSdkRaw.default ? IconSdkRaw.default : IconSdkRaw;
export const { Converter, CallTransactionBuilder, CallBuilder, IconService } = IconSdk;

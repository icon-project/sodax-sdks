import { useXWalletStore } from '@/useXWalletStore.js';
import { isIconAddress } from '@sodax/wallet-sdk-core';
import { ICONexRequestEventType, ICONexResponseEventType, request } from './iconex/index.js';

export const reconnectIcon = async () => {
  const iconConnection = useXWalletStore.getState().xConnections.ICON;
  if (!iconConnection) return;

  const recentXConnectorId = iconConnection.xConnectorId;

  try {
    const detail = await request({
      type: ICONexRequestEventType.REQUEST_ADDRESS,
    });

    if (detail?.type === ICONexResponseEventType.RESPONSE_ADDRESS && isIconAddress(detail.payload)) {
      useXWalletStore.getState().setXConnection('ICON', {
        xAccount: {
          address: detail.payload,
          xChainType: 'ICON',
        },
        xConnectorId: recentXConnectorId,
      });
    }
  } catch {
    // Wallet unavailable or relay timeout during hydration: leave the persisted
    // connection untouched rather than throwing.
  }
};

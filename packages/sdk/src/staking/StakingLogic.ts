// packages/sdk/src/services/staking/StakingLogic.ts
import { type Address, type Hex, type HttpTransport, type PublicClient, encodeFunctionData } from 'viem';
import { stakedSodaAbi } from '../shared/abis/stakedSoda.abi.js';
import { stakingRouterAbi } from '../shared/abis/stakingRouter.abi.js';
import type { EvmContractCall, UserUnstakeInfo } from '@sodax/types';

/**
 * Pure utility class for staking contract interactions on the Sonic hub chain.
 *
 * Contains two categories of static helpers:
 * - **On-chain reads** (async) — query the xSoda ERC-4626 vault and StakingRouter for balances,
 *   conversion rates, preview amounts, and pending unstake requests.
 * - **Call encoders** (sync) — produce `EvmContractCall` objects for inclusion in a multicall
 *   batch payload sent to the hub via `encodeContractCalls`.
 *
 * This class is not instantiable; all methods are static and have no side effects.
 */
export class StakingLogic {
  private constructor() {}

  /**
   * Retrieves all pending unstake requests for a user from the StakedSoda contract.
   * @param stakedSoda - The address of the StakedSoda contract.
   * @param user - The hub wallet address to query.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns Array of `UserUnstakeInfo` records for all active unstake requests.
   */
  public static async getUnstakeSodaRequests(
    stakedSoda: Address,
    user: Address,
    publicClient: PublicClient<HttpTransport>,
  ): Promise<readonly UserUnstakeInfo[]> {
    const requests = await publicClient.readContract({
      address: stakedSoda,
      abi: stakedSodaAbi,
      functionName: 'getUnstakeRequests',
      args: [user],
    });

    return requests;
  }

  /**
   * Encodes the depositFor transaction data.
   * @param stakedSoda - The address of the StakedSoda contract.
   * @param account - The address of the account to deposit for.
   * @param amount - The amount of tokens to deposit.
   * @returns The encoded contract call data.
   */
  static encodeDepositFor(stakedSoda: Address, account: Address, amount: bigint): EvmContractCall {
    return {
      address: stakedSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'depositFor',
        args: [account, amount],
      }),
    };
  }

  /**
   * Encodes the withdrawTo transaction data.
   * @param stakedSoda - The address of the StakedSoda contract.
   * @param account - The address of the account to withdraw to.
   * @param value - The amount of tokens to withdraw.
   * @returns The encoded contract call data.
   */
  static encodeWithdrawTo(stakedSoda: Address, account: Address, value: bigint): EvmContractCall {
    return {
      address: stakedSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'withdrawTo',
        args: [account, value],
      }),
    };
  }

  /**
   * Encodes the unstake transaction data.
   * @param stakedSoda - The address of the StakedSoda contract.
   * @param account - The address of the account to unstake for.
   * @param value - The amount of tokens to unstake.
   * @returns The encoded contract call data.
   */
  static encodeUnstake(stakedSoda: Address, account: Address, value: bigint): EvmContractCall {
    return {
      address: stakedSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'unstake',
        args: [account, value],
      }),
    };
  }

  /**
   * Encodes the `cancelUnstakeRequest` call on the StakedSoda contract.
   * @param stakedSoda - The address of the StakedSoda contract.
   * @param requestId - The ID of the unstake request to cancel.
   * @returns The encoded contract call data.
   */
  static encodeCancelUnstakeSodaRequest(stakedSoda: Address, requestId: bigint): EvmContractCall {
    return {
      address: stakedSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'cancelUnstakeRequest',
        args: [requestId],
      }),
    };
  }

  /**
   * Convenience alias for `encodeCancelUnstakeSodaRequest`.
   * @param stakedSoda - The address of the StakedSoda contract.
   * @param requestId - The ID of the unstake request to cancel.
   * @returns The encoded contract call data.
   */
  static encodeCancelUnstakeRequest(stakedSoda: Address, requestId: bigint): EvmContractCall {
    return StakingLogic.encodeCancelUnstakeSodaRequest(stakedSoda, requestId);
  }

  /**
   * Encodes the claim transaction data.
   * @param stakedSoda - The address of the StakedSoda contract.
   * @param requestId - The ID of the unstake request to claim.
   * @returns The encoded contract call data.
   */
  static encodeClaim(stakedSoda: Address, requestId: bigint): EvmContractCall {
    return {
      address: stakedSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'claim',
        args: [requestId],
      }),
    };
  }

  // xSoda ERC4626 Read Methods

  /**
   * Returns the total amount of SODA assets held by the xSoda vault (`totalAssets`).
   * @param xSoda - The address of the xSoda ERC-4626 vault contract.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns Total SODA deposited across all stakers.
   */
  public static async getXSodaTotalAssets(xSoda: Address, publicClient: PublicClient<HttpTransport>): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'totalAssets',
      args: [],
    });
  }

  /**
   * Calculates the number of xSoda shares equivalent to a given amount of SODA assets (`convertToShares`).
   * @param xSoda - The address of the xSoda ERC-4626 vault contract.
   * @param assets - The SODA asset amount to convert.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns The xSoda share count equivalent to `assets` at the current exchange rate.
   */
  public static async convertSodaToXSodaShares(
    xSoda: Address,
    assets: bigint,
    publicClient: PublicClient<HttpTransport>,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'convertToShares',
      args: [assets],
    });
  }

  /**
   * Calculates the SODA asset amount corresponding to a given number of xSoda shares (`convertToAssets`).
   * @param xSoda - The address of the xSoda ERC-4626 vault contract.
   * @param shares - The xSoda share count to convert.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns The SODA asset amount equivalent to `shares` at the current exchange rate.
   */
  public static async convertXSodaSharesToSoda(
    xSoda: Address,
    shares: bigint,
    publicClient: PublicClient<HttpTransport>,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'convertToAssets',
      args: [shares],
    });
  }

  /**
   * Simulates a SODA deposit into the xSoda vault (`previewDeposit`) without executing it.
   * @param xSoda - The address of the xSoda ERC-4626 vault contract.
   * @param assets - The SODA amount to preview depositing.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns The xSoda shares that would be minted for `assets`.
   */
  public static async previewXSodaDeposit(
    xSoda: Address,
    assets: bigint,
    publicClient: PublicClient<HttpTransport>,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'previewDeposit',
      args: [assets],
    });
  }

  /**
   * Simulates minting a specific number of xSoda shares (`previewMint`) without executing it.
   * @param xSoda - The address of the xSoda ERC-4626 vault contract.
   * @param shares - The xSoda share count to preview minting.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns The SODA assets that would need to be deposited to mint `shares`.
   */
  public static async previewXSodaMint(
    xSoda: Address,
    shares: bigint,
    publicClient: PublicClient<HttpTransport>,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'previewMint',
      args: [shares],
    });
  }

  /**
   * Simulates withdrawing a specific SODA amount from the xSoda vault (`previewWithdraw`) without executing it.
   * @param xSoda - The address of the xSoda ERC-4626 vault contract.
   * @param assets - The SODA amount to preview withdrawing.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns The xSoda shares that would be burned to withdraw `assets`.
   */
  public static async previewXSodaWithdraw(
    xSoda: Address,
    assets: bigint,
    publicClient: PublicClient<HttpTransport>,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'previewWithdraw',
      args: [assets],
    });
  }

  /**
   * Simulates redeeming a specific number of xSoda shares (`previewRedeem`) without executing it.
   * @param xSoda - The address of the xSoda ERC-4626 vault contract.
   * @param shares - The xSoda share count to preview redeeming.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns The SODA assets that would be withdrawn for `shares`.
   */
  public static async previewXSodaRedeem(
    xSoda: Address,
    shares: bigint,
    publicClient: PublicClient<HttpTransport>,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: xSoda,
      abi: stakedSodaAbi,
      functionName: 'previewRedeem',
      args: [shares],
    });
  }

  // xSoda ERC4626 Encoding Methods

  /**
   * Encodes the xSoda deposit transaction data (deposit SODA to get xSoda shares).
   * @param xSoda - The address of the xSoda token contract.
   * @param assets - The amount of SODA assets to deposit.
   * @param receiver - The address of the receiver.
   * @returns The encoded contract call data.
   */
  static encodeXSodaDeposit(xSoda: Address, assets: bigint, receiver: Address): EvmContractCall {
    return {
      address: xSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'deposit',
        args: [assets, receiver],
      }),
    };
  }

  /**
   * Encodes the xSoda mint transaction data (mint xSoda shares by depositing SODA).
   * @param xSoda - The address of the xSoda token contract.
   * @param shares - The number of xSoda shares to mint.
   * @param receiver - The address of the receiver.
   * @returns The encoded contract call data.
   */
  static encodeXSodaMint(xSoda: Address, shares: bigint, receiver: Address): EvmContractCall {
    return {
      address: xSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'mint',
        args: [shares, receiver],
      }),
    };
  }

  /**
   * Encodes the xSoda withdraw transaction data (withdraw SODA by burning xSoda shares).
   * @param xSoda - The address of the xSoda token contract.
   * @param assets - The amount of SODA assets to withdraw.
   * @param receiver - The address of the receiver.
   * @param owner - The address of the owner.
   * @returns The encoded contract call data.
   */
  static encodeXSodaWithdraw(xSoda: Address, assets: bigint, receiver: Address, owner: Address): EvmContractCall {
    return {
      address: xSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'withdraw',
        args: [assets, receiver, owner],
      }),
    };
  }

  /**
   * Encodes the xSoda redeem transaction data (redeem xSoda shares to get SODA).
   * @param xSoda - The address of the xSoda token contract.
   * @param shares - The number of xSoda shares to redeem.
   * @param receiver - The address of the receiver.
   * @param owner - The address of the owner.
   * @returns The encoded contract call data.
   */
  static encodeXSodaRedeem(xSoda: Address, shares: bigint, receiver: Address, owner: Address): EvmContractCall {
    return {
      address: xSoda,
      value: 0n,
      data: encodeFunctionData({
        abi: stakedSodaAbi,
        functionName: 'redeem',
        args: [shares, receiver, owner],
      }),
    };
  }

  // StakingRouter Methods

  /**
   * Encodes the StakingRouter stake transaction data.
   * @param stakingRouter - The address of the StakingRouter contract.
   * @param amount - The xSoda vault token amount to stake (translated to 18 decimals).
   * @param to - The address to receive the staked tokens.
   * @param minReceive - The minimum amount to receive.
   * @returns The encoded contract call data.
   */
  static encodeStakingRouterStake(
    stakingRouter: Address,
    amount: bigint,
    to: Address,
    minReceive: bigint,
  ): EvmContractCall {
    return {
      address: stakingRouter,
      value: 0n,
      data: encodeFunctionData({
        abi: stakingRouterAbi,
        functionName: 'stake',
        args: [amount, to, minReceive],
      }),
    };
  }

  /**
   * Encodes the StakingRouter unstake transaction data.
   * @param stakingRouter - The address of the StakingRouter contract.
   * @param amount - The amount of xSoda to unstake.
   * @param minAmount - The minimum amount of SODA to receive.
   * @param asset - The asset address to receive.
   * @param chainID - The destination chain ID.
   * @param to - The destination address as bytes.
   * @returns The encoded contract call data.
   */
  static encodeStakingRouterUnstake(
    stakingRouter: Address,
    amount: bigint,
    minAmount: bigint,
    asset: Address,
    chainID: bigint,
    to: Hex,
  ): EvmContractCall {
    return {
      address: stakingRouter,
      value: 0n,
      data: encodeFunctionData({
        abi: stakingRouterAbi,
        functionName: 'unstake',
        args: [amount, minAmount, asset, chainID, to],
      }),
    };
  }

  // Estimation Methods

  /**
   * Estimates the xSoda shares and preview-deposit amount for staking a given SODA amount.
   *
   * Delegates to `StakingRouter.estimateXSodaAmount`, which accounts for the current vault
   * exchange rate. Use this to display expected output before executing a stake transaction.
   *
   * @param stakingRouter - The address of the StakingRouter contract.
   * @param amount - The SODA amount to estimate.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns Tuple `[xSodaAmount, previewDepositAmount]` — estimated shares and vault preview figure.
   */
  public static async estimateXSodaAmount(
    stakingRouter: Address,
    amount: bigint,
    publicClient: PublicClient<HttpTransport>,
  ): Promise<readonly [bigint, bigint]> {
    return publicClient.readContract({
      address: stakingRouter,
      abi: stakingRouterAbi,
      functionName: 'estimateXSodaAmount',
      args: [amount],
    });
  }

  /**
   * Estimates the SODA output for instantly unstaking a given xSoda amount.
   *
   * Delegates to `StakingRouter.estimateInstantUnstake`. The result reflects current
   * liquidity conditions and may differ from the actual output at execution time.
   * Use this to set an appropriate `minAmount` slippage guard before calling `instantUnstake`.
   *
   * @param stakingRouter - The address of the StakingRouter contract.
   * @param amount - The xSoda share amount to estimate.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns The estimated SODA output for the instant unstake.
   */
  public static async estimateInstantUnstake(
    stakingRouter: Address,
    amount: bigint,
    publicClient: PublicClient<HttpTransport>,
  ): Promise<bigint> {
    return publicClient.readContract({
      address: stakingRouter,
      abi: stakingRouterAbi,
      functionName: 'estimateInstantUnstake',
      args: [amount],
    });
  }
}

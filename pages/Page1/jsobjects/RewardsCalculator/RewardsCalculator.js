export default {
	finoaDelegationsList: ["B62qjGuAFtLagXc7qv8Jj9T9kKNNbfQmd5pJXzFfeHrjEavRFnEDfWV", "B62qqgYzT67iGyBudDH5V8w8GowkYG5hjgRdW6xWb4eTyQnTDJQbQJY"],
	myPublicKey: "B62qoA5XwfEVnXbcrzphGH1TVuqxeJ5bhX7vTS3hcxpQFHnStG3MQk9",
	confirmations: 15,
	minBlockHeight: 0,
	fee: 0.1,
	epoch: 0,
	fnValidateInput () {

		// validate the available input parameters
		const epochNumber = Number(inputEpoch.text);
		if (Number.isNaN(epochNumber) || epochNumber == undefined || epochNumber < 50) {
			console.error("invalid epoch input");
			return false;
		}

		const fromDate = moment(fromDatePicker.selectedDate);
		const toDate = moment(toDatePicker.selectedDate);
		const dateDeltaDays = toDate.diff(fromDate, 'days');
		if (dateDeltaDays < 1) {
			console.error("from and to dates must be atleast a day apart");
			return false;
		}

		return true;
	},
	async fnPrefillEpoch() {

		const v = await MinaExplorerFunctions.getEpoch();
		if (v == undefined) return;

		console.log("fnPrefillEpoch = ", v);
		this.epoch = v;
		inputEpoch.setValue(v.toString());
	},
	async execute () {
		if (!this.fnValidateInput()) return;

		// clear out the table contents
		resetWidget(tablePayouts);

		const epochNumber = Number(inputEpoch.text);
		const fromDate = moment(fromDatePicker.selectedDate);
		const fromDateString = fromDate.format("YYYY-MM-DDTHH:mm:ss[Z]");
		const toDate = moment(toDatePicker.selectedDate);
		const toDateString = toDate.format("YYYY-MM-DDTHH:mm:ss[Z]");

		// console.log("using ", epochNumber, " from=", fromDateString , " to=", toDateString);

		let ledgerHash = await MinaExplorerFunctions.getLedgerHash(epochNumber);
		if (ledgerHash == undefined) {
			console.error("invalid ledger hash received; abort");
			return;
		}

		console.log("ledger hash = ", ledgerHash);

		// get the max block height to pay rewards for 
		let blockHeight = await MinaExplorerFunctions.getLatestHeight();
		if (blockHeight == undefined) {
			console.error("failed to get latest block height");
			return;
		}

		console.log("latest height = ", blockHeight);

		const maxHeight = blockHeight - this.confirmations;
		if (maxHeight < 1) {
			console.error("maxheight is invalid = ", maxHeight);
			return;
		}

		console.log("max height = ", maxHeight);

		let total_staking_balance = 0;
		let total_staking_balance_finoa = 0;
		let payouts = [];
		let all_blocks_total_rewards = 0;
		let all_blocks_total_fees = 0;
		let store_payout = [];
		let blocks_table = [];

		// get the staking ledger for the given epoch
		const ledgerEntries = await MinaExplorerFunctions.getStakingLedger(this.myPublicKey, ledgerHash);
		if (ledgerEntries == undefined || ledgerEntries.length == 0) {
			console.error("invalid staking ledger entries found; abort = ", ledgerEntries);
			return;
		}

		console.log("found length of staking ledger = ", ledgerEntries.length);

		// for all stakes in the list, add in the corresponding payouts
		ledgerEntries.forEach( (stakeItem) => {

			const timedWeighting = (stakeItem.timing == undefined || stakeItem.timing == null) ? 1 : stakeItem.timing.timed_weighting;

			let isFinoaDelegation = false;
			if (this.finoaDelegationsList.includes(stakeItem.public_key)) {
				console.log("finoa delegation - ", stakeItem.public_key);
				isFinoaDelegation = true;
				total_staking_balance_finoa += stakeItem.balance;
				console.log("finoa new staking balance = ", total_staking_balance_finoa);
			}

			payouts.push({
				"publicKey": stakeItem.public_key,
				"total": 0,
				"staking_balance": stakeItem.balance,
				"timed_weighting": timedWeighting,
				"finoa_delegation": isFinoaDelegation
			});

			total_staking_balance += stakeItem.balance;

		});

		// ensure that the total balance is more than or equal to finoa's total balance
		if (total_staking_balance < total_staking_balance_finoa) {
			console.error("something went wrong with balance calculation between delegations");
			return;
		}

		console.log("total staking balance calculation done: total = ", total_staking_balance);
		console.log("total staking balance calculation done: finoa = ", total_staking_balance_finoa);
		console.log("found delegations in the pool = ", payouts.length);
		console.log("start time is ", fromDateString);
		console.log("end time is ", toDateString);
		const blocks = await MinaExplorerFunctions.getBlocks(this.myPublicKey,epochNumber,this.minBlockHeight,blockHeight,fromDateString,toDateString);

		if (blocks == undefined || blocks.length == 0) {
			console.error("Nothing to payout as we didn't win anything; abort");
			return;
		}

		console.log("received ", blocks.length, " blocks");

		// blocks loop
		blocks.forEach( (block) => {

			// keep track of payouts per block
			let other_payouts = 0;

			if (block?.transactions?.coinbaseReceiverAccount == undefined || block?.transactions?.coinbaseReceiverAccount == null) {
				console.log(block?.blockHeight, " didn't have a coinbase so won it but no rewards");
				return;
			}

			let coinbase_receiver = block.transactions.coinbaseReceiverAccount.publicKey;
			let sum_effective_pool_stakes = 0;
			let effective_pool_stakes = {};


			const fee_transfers = block.transactions.feeTransfer.filter ( (f) => f.type == "Fee_transfer");
			const fee_transfers_coinbase = block.transactions.feeTransfer.filter ( (f) => f.type == "Fee_transfer_via_coinbase");

			// console.log("fee_transfers = ", fee_transfers.length, " for coinbase=", fee_transfers_coinbase.length);
			let total_fee_transfers = 0;
			fee_transfers.forEach( (t) => total_fee_transfers += Number(t.fee));
			let fee_transfer_for_coinbase = 0;
			fee_transfers_coinbase.forEach( (t) => fee_transfer_for_coinbase += Number(t.fee));

			// console.log("total_fee_transfers=", total_fee_transfers, " fee_transfer_for_coinbase=", fee_transfer_for_coinbase);

			const list_fee_transfer_to_creator = fee_transfers.filter( (t) => t.recipient == coinbase_receiver);
			let total_fee_transfer_to_creator = 0;
			list_fee_transfer_to_creator.forEach( (t) => (total_fee_transfer_to_creator += Number(t.fee)));

			// console.log("total_fee_transfer_to_creator = ", total_fee_transfer_to_creator);

			const fee_transfer_to_snarkers = total_fee_transfers - total_fee_transfer_to_creator;
			// console.log("fee_transfer_to_snarkers = ", fee_transfer_to_snarkers);

			// Determine the supercharged weighting for the block

			// New way uses fee transfers so we share the resulting profitability of the tx and take into account the coinbase snark
			let supercharged_weighting = 1 + (1 / ( 1 + Number(total_fee_transfer_to_creator) /
																						 (Number(block.transactions.coinbase) - Number(fee_transfer_for_coinbase))));

			let total_rewards_prev_method = Number(block.transactions.coinbase) + Number(block.txFees) - Number(block.snarkFees)

			let total_rewards = Number(block.transactions.coinbase) + Number(total_fee_transfer_to_creator) - Number(fee_transfer_for_coinbase);

			console.log("total_rewards_prev_method = ", total_rewards_prev_method, " total_rewards=", total_rewards);

			blocks_table.push([ block.blockHeight, 
												 supercharged_weighting, 
												 block.transactions.coinbase, 
												 total_fee_transfer_to_creator, 
												 fee_transfer_to_snarkers, 
												 fee_transfer_for_coinbase
												]);

			// We calculate rewards multiple ways to sense check
			if (total_rewards != total_rewards_prev_method) {
				console.error("something went wrong with rewards calculation; abort");
				return;
			}

			const total_fees = Number(this.fee * total_rewards);

			all_blocks_total_rewards += total_rewards;
			all_blocks_total_fees += total_fees;

			payouts.forEach( (p) => {

				let supercharged_contribution = ( (supercharged_weighting - 1) * p.timed_weighting) + 1;
				let effective_stake = p.staking_balance * supercharged_contribution;

				effective_pool_stakes[p.publicKey] = effective_stake;
				sum_effective_pool_stakes += effective_stake;
			});

			if (sum_effective_pool_stakes > 2 * total_staking_balance) {
				console.error("something went wrong with pool stake calculation; sum_effective_pool_stakes should be lesser; abort");
				return;
			}

			const block_pool_share = total_rewards;

			payouts.forEach( (p) => {

				let effective_pool_weighting = effective_pool_stakes[p.publicKey] / sum_effective_pool_stakes;

				// ensure the effective weighting is <= 1
				if (effective_pool_weighting > 1) {
					console.error("effective pool weighting was found to be >1; Major issue; abort");
					return;
				}

				let block_total = Math.floor(block_pool_share * effective_pool_weighting * (1 - this.fee));
				p.total += block_total;

				other_payouts += block_total;
			});

			// Final check
			// These are essentially the same but we allow for a tiny bit of nanomina rounding and worst case we never pay more
			if (other_payouts + total_fees > total_rewards) {
				console.error("other_payouts + total_fees must be less than total_rewards; abort");
				return;
			}

		});

		// console.log(blocks_table);
		console.log("Paying out in this window=", all_blocks_total_rewards, " NanoMINA ~ ", Number(all_blocks_total_rewards / Math.pow(10,9)), " MINA");
		console.log("FCS validator fee=", all_blocks_total_fees, " NanoMINA ~ ", Number(all_blocks_total_fees / Math.pow(10,9)), " MINA");
		console.log("Number of reward payouts scheduled = ", payouts.length);

		// filter out the delegations done by Finoa and only pay those
		const finoaPayouts = payouts.filter( (p) => p.finoa_delegation);

		finoaPayouts.forEach( (p) => {
			console.log("Sending reward = ", p.total, " to ", p.publicKey);
		});

		tablePayouts.setData(finoaPayouts);
		return finoaPayouts;
	}
}
export default {
	myVar1: [],
	myVar2: {},
	myFun1 () {
		//	write code here
		//	this.myVar1 = [1,2,3]
	},
	async getEpoch() {
		
		const response = await GraphQL_getEpoch.run();
		if (response == null || response.data == null || response.data.stakes.length == 0) return undefined;
		
		return response.data.stakes[0].epoch;
	},
	async getLedgerHash (epoch) {

		if (epoch == undefined || epoch.length == 0) return undefined;

		const response = await GraphQL_getLedgerHash.run({"epoch": epoch});

		if (response.data == null) {
			console.error("no data received from graphql api");
			return undefined;
		}

		console.log(response);
		const hashValue = response.data.blocks[0].protocolState.consensusState.stakingEpochData.ledger.hash;
		if (hashValue == undefined) {
			console.error("no data received from graphql api");
			return undefined;
		}

		// console.log("got valid data from graphql");

		return hashValue;
		//	use async-await or promises
		//	await storeValue('varName', 'hello world')
	},
	async getLatestHeight() {
		const response = await GraphQL_getLatestHeight.run();
		if (response == null || response.data == null || response.data.blocks.length == 0) return undefined;
		if (response.data.blocks[0].blockHeight <= 0) return undefined;

		return response.data.blocks[0].blockHeight;
	},
	async getBlocks(public_key, epoch, min_height, max_height, fromDate, toDate) {

		const response = await GraphQL_getBlocks.run({
			"creator": public_key,
			"epoch": epoch,
			"blockHeightMin": min_height,
			"blockHeightMax": max_height,
			"dateTimeMin": fromDate,
			"dateTimeMax": toDate
		});

		console.log("blocks raw = ", response);
		if (response == null || response.data == null) return undefined;

		return response.data.blocks;
	},
	async getStakingLedger(delegate, ledger_hash) {
		const response = await GraphQL_getStakingLedger.run({
			"delegate": delegate,
			"ledgerHash": ledger_hash
		});

		if (response == null || response.data == null) return undefined;

		return response.data.stakes;
	}
}
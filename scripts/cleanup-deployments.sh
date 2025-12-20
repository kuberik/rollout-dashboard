#!/bin/bash

ENV=$1

for ID in $(gh api -X GET /repos/LittleChimera/kuberik-testing/deployments?environment=${ENV// /%20} | jq -r ".[] | .id")
do
  echo "Deleting deployment $ID"
  gh api -X DELETE /repos/LittleChimera/kuberik-testing/deployments/$ID | jq '.'
done
